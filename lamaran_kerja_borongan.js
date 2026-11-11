// ===================================================
// lamaran_kerja_borongan.js
// Halaman publik "Portal Lamaran Kerja Borongan"
// Semua akses database lewat FUNGSI DATABASE (rpc), bukan query tabel:
//   public.cek_lamaran_ktp       -> cek No KTP (sudah melamar? pernah karyawan?)
//   public.kirim_lamaran_borongan -> simpan lamaran
// WAJIB: jalankan lamaran_kerja_borongan.sql di Supabase terlebih dulu.
// ===================================================

// ===================================================
// KELOMPOK 1: PENGATURAN (KONFIGURASI)
// Fungsi: nilai tetap yang dipakai di seluruh file.
// ===================================================
// Klien dibuat di sini (anon key memang publik). Jika halaman lain sudah membuat
// window.supabaseClient, itu yang dipakai.
const SUPABASE_URL = "https://gkqxzxwiawfpjtnzexvq.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdrcXh6eHdpYXdmcGp0bnpleHZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2MzI0MzksImV4cCI6MjEwMDIwODQzOX0.tFjGOY1z35tMZi0re-oYlIF9yXxa9-8uYtKBBYmwpm8";
const supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STORAGE_KEY = "lamaran_borongan_draft";   // kunci session storage (dihapus setelah submit)
const RPC_CEK = "cek_lamaran_ktp";
const RPC_KIRIM = "kirim_lamaran_borongan";
const TOTAL_STEPS = 4;
const MAX_UMUR = 40;                            // usia maksimal pelamar (tahun)
const INFO_KERABAT = "Kerabat (saudara, teman atau kenalan)";

// ===================================================
// KELOMPOK 2: STATE (DATA SEMENTARA DI MEMORI)
// Fungsi: menyimpan tahap aktif, hasil cek KTP, dan status kirim.
// ===================================================
const state = {
    step: 1,
    agree: false,
    ktpBlacklist: false,    // true = KTP milik mantan karyawan berstatus blacklist -> form dikunci
    ktpAktif: false,        // true = KTP sudah terdaftar aktif -> form dikunci
    ktpPernahKaryawan: false, // true = KTP ada di hrd.employees -> radio "Ya" terkunci
    ktpChecked: "",         // KTP (16 digit) yang sudah selesai dicek
    cekSeq: 0,              // penanda permintaan cek terbaru
    cekTimer: null,
    sending: false
};

// ===================================================
// KELOMPOK 3: FUNGSI BANTU (HELPER)
// ===================================================
const $ = (id) => document.getElementById(id);
const digits = (s) => String(s || "").replace(/\D/g, "");

function esc(v) {
    return String(v ?? "")
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// KTP: 6-6-4, contoh "375805 120176 0001"
function formatKtp(raw) {
    const d = digits(raw).slice(0, 16);
    return [d.slice(0, 6), d.slice(6, 12), d.slice(12, 16)].filter(Boolean).join(" ");
}

// No Telp: 4-4-sisanya (maks 13 digit), contoh "0821 4320 12345"
function formatTelp(raw) {
    const d = digits(raw).slice(0, 13);
    return [d.slice(0, 4), d.slice(4, 8), d.slice(8, 13)].filter(Boolean).join(" ");
}

// Usia dalam tahun penuh pada hari ini
function hitungUmur(tgl) {
    const d = new Date(tgl), n = new Date();
    let u = n.getFullYear() - d.getFullYear();
    const m = n.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && n.getDate() < d.getDate())) u--;
    return u;
}

function radioValue(name) {
    const r = document.querySelector(`input[name="${name}"]:checked`);
    return r ? r.value : "";
}

function setError(id, msg) {
    $(id).textContent = msg || "";
}

function markInvalid(inputId, invalid) {
    $(inputId).classList.toggle("invalid", !!invalid);
}

// ===================================================
// KELOMPOK 4: SESSION STORAGE (DUMMY)
// Fungsi: menyimpan tahap, centang validasi, dan draft isian agar tidak
// hilang saat halaman dimuat ulang. TIDAK dikirim ke database.
// Seluruhnya dihapus setelah form berhasil dikirim.
// ===================================================
function readForm() {
    return {
        ktp: digits($("fKtp").value),
        nama: $("fNama").value.trim(),
        alamat: $("fAlamat").value.trim(),
        jk: $("fJk").value,
        pendidikan: $("fPendidikan").value,
        tgl: $("fTgl").value,
        telp: digits($("fTelp").value),
        pernah: radioValue("pernah"),
        descPernah: $("fDescPernah").value.trim(),
        info: $("fInfo").value,
        referensi: $("fReferensi").value.trim(),
        descReferensi: $("fDescReferensi").value.trim(),
        pungli: radioValue("pungli"),
        descPungli: $("fDescPungli").value.trim()
    };
}

function saveDraft() {
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ step: state.step, agree: state.agree, form: readForm() }));
    } catch (e) { /* session storage penuh / diblokir: abaikan */ }
}

function clearDraft() {
    try { sessionStorage.removeItem(STORAGE_KEY); } catch (e) {}
}

function loadDraft() {
    let d = null;
    try { d = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null"); } catch (e) {}
    if (!d) return;
    state.agree = !!d.agree;
    $("chkAgree").checked = state.agree;
    const f = d.form || {};
    $("fKtp").value = formatKtp(f.ktp);
    $("fNama").value = f.nama || "";
    $("fAlamat").value = f.alamat || "";
    $("fJk").value = f.jk || "";
    $("fPendidikan").value = f.pendidikan || "";
    $("fTgl").value = f.tgl || "";
    $("fTelp").value = formatTelp(f.telp);
    $("fDescPernah").value = f.descPernah || "";
    $("fInfo").value = f.info || "";
    $("fReferensi").value = f.referensi || "";
    $("fDescReferensi").value = f.descReferensi || "";
    $("fDescPungli").value = f.descPungli || "";
    const setRadio = (name, val) => { const r = document.querySelector(`input[name="${name}"][value="${val}"]`); if (r) r.checked = true; };
    if (f.pernah) setRadio("pernah", f.pernah);
    setRadio("pungli", f.pungli || "tidak");
    // Tahap tersimpan hanya dipulihkan sampai 3; tahap review selalu dihitung ulang
    state.step = Math.min(Math.max(parseInt(d.step, 10) || 1, 1), 3);
    if (state.step >= 3 && !state.agree) state.step = 2;
}

// ===================================================
// KELOMPOK 5: NAVIGASI TAHAP
// Fungsi: menampilkan panel sesuai tahap, mengatur penunjuk tahap dan
// tombol Kembali/Lanjut/Kirim.
// ===================================================
function showStep(n) {
    state.step = n;
    for (let i = 1; i <= TOTAL_STEPS; i++) $("panel" + i).hidden = (i !== n);
    $("panelDone").hidden = true;

    document.querySelectorAll("#lkSteps .lk-step").forEach(el => {
        const s = parseInt(el.dataset.s, 10);
        el.classList.toggle("active", s === n);
        el.classList.toggle("done", s < n);
    });

    $("btnBack").hidden = (n === 1);
    $("btnNext").textContent = n === TOTAL_STEPS ? "Kirim Lamaran" : "Lanjut";
    updateNextState();
    if (n === 4) renderReview();
    window.scrollTo({ top: 0, behavior: "smooth" });
    saveDraft();
}

// Tombol Lanjut dikunci jika syarat tahap belum terpenuhi
function updateNextState() {
    let ok = true;
    if (state.step === 2) ok = state.agree;
    if (state.step === 3) ok = !state.ktpAktif && !state.ktpBlacklist;   // hardlock: sudah terdaftar / blacklist
    if (state.step === 4) ok = !state.sending && !state.ktpAktif && !state.ktpBlacklist;
    $("btnNext").disabled = !ok;
}

async function onNext() {
    if (state.step === 3) {
        if (!(await validateStep3())) return;
    }
    if (state.step === TOTAL_STEPS) { await submitForm(); return; }
    showStep(state.step + 1);
}

function onBack() {
    if (state.step > 1 && !state.sending) showStep(state.step - 1);
}

// ===================================================
// KELOMPOK 6: CEK NO KTP (lewat fungsi database)
// Fungsi: setelah 16 digit terisi, panggil public.cek_lamaran_ktp.
//  - terdaftar_aktif  -> tampilkan peringatan + kunci form (hardlock)
//  - pernah_karyawan  -> radio "pernah di DMB" otomatis "Ya" dan terkunci
// Server memeriksa ulang saat submit, jadi hasil ini hanya untuk kenyamanan.
// ===================================================
function onKtpInput() {
    const el = $("fKtp");
    el.value = formatKtp(el.value);
    const d = digits(el.value);
    setError("eKtp", "");
    markInvalid("fKtp", false);

    clearTimeout(state.cekTimer);
    if (d.length < 16) {
        resetKtpStatus();
        return;
    }
    if (d === state.ktpChecked) return;
    state.cekTimer = setTimeout(() => cekKtp(d), 300);
}

function resetKtpStatus() {
    state.ktpAktif = false;
    state.ktpBlacklist = false;
    state.ktpPernahKaryawan = false;
    state.ktpChecked = "";
    $("alertKtp").hidden = true;
    $("alertBlacklist").hidden = true;
    $("infoKtpCek").hidden = true;
    applyPernahLock();
    updateNextState();
}

async function cekKtp(d) {
    const seq = ++state.cekSeq;
    $("infoKtpCek").hidden = false;
    try {
        const { data, error } = await supabaseClient.rpc(RPC_CEK, { p_nik: d });
        if (seq !== state.cekSeq) return;
        if (error) throw error;
        state.ktpChecked = d;
        state.ktpAktif = data && data.terdaftar_aktif === true;
        state.ktpPernahKaryawan = data && data.pernah_karyawan === true;
        state.ktpBlacklist = data && data.blacklist === true;
        $("alertKtp").hidden = !state.ktpAktif;
        $("alertBlacklist").hidden = !state.ktpBlacklist;
    } catch (err) {
        if (seq !== state.cekSeq) return;
        console.error("Gagal cek No KTP:", err);
        state.ktpChecked = "";
        setError("eKtp", "Gagal memeriksa No KTP. Periksa koneksi internet anda.");
    } finally {
        if (seq === state.cekSeq) $("infoKtpCek").hidden = true;
    }
    applyPernahLock();
    updateNextState();
}

// ===================================================
// KELOMPOK 7: LOGIKA KOLOM BERSYARAT (Data Pendukung)
// Fungsi: menampilkan/menyembunyikan kolom sesuai jawaban sebelumnya.
// ===================================================
function applyPernahLock() {
    const ya = document.querySelector('input[name="pernah"][value="ya"]');
    const tidak = document.querySelector('input[name="pernah"][value="tidak"]');
    const locked = state.ktpPernahKaryawan;
    if (locked) ya.checked = true;
    ya.disabled = locked;
    tidak.disabled = locked;
    $("lblPernahYa").classList.toggle("disabled", locked);
    $("lblPernahTidak").classList.toggle("disabled", locked);
    $("hintPernah").hidden = !locked;
    applyConditional();
}

function applyConditional() {
    $("wrapDescPernah").hidden = radioValue("pernah") !== "ya";
    $("wrapReferensi").hidden = $("fInfo").value !== INFO_KERABAT;
    $("wrapDescPungli").hidden = radioValue("pungli") !== "ya";
}

// ===================================================
// KELOMPOK 8: VALIDASI TAHAP 3
// Fungsi: memeriksa semua isian. Kolom bersyarat hanya diperiksa jika tampil.
// KTP dicek ulang ke server di sini supaya tidak ada celah (misal pengguna
// menekan Lanjut sebelum hasil cek selesai).
// ===================================================
async function validateStep3() {
    const f = readForm();
    let firstBad = null;
    const bad = (inputId, errId, msg) => {
        setError(errId, msg); markInvalid(inputId, true);
        if (!firstBad) firstBad = inputId;
    };
    const ok = (inputId, errId) => { setError(errId, ""); markInvalid(inputId, false); };

    // Pastikan cek KTP terbaru sudah selesai
    if (f.ktp.length === 16 && state.ktpChecked !== f.ktp) {
        clearTimeout(state.cekTimer);
        await cekKtp(f.ktp);
    }

    if (f.ktp.length !== 16) bad("fKtp", "eKtp", "No KTP harus 16 digit."); else ok("fKtp", "eKtp");
    if (state.ktpAktif) { $("alertKtp").hidden = false; if (!firstBad) firstBad = "fKtp"; }
    if (state.ktpBlacklist) { $("alertBlacklist").hidden = false; if (!firstBad) firstBad = "fKtp"; }

    if (f.nama.length < 3) bad("fNama", "eNama", "Nama wajib diisi."); else ok("fNama", "eNama");
    if (f.alamat.length < 5) bad("fAlamat", "eAlamat", "Alamat wajib diisi."); else ok("fAlamat", "eAlamat");
    if (!f.jk) bad("fJk", "eJk", "Pilih jenis kelamin."); else ok("fJk", "eJk");
    if (!f.pendidikan) bad("fPendidikan", "ePendidikan", "Pilih pendidikan terakhir."); else ok("fPendidikan", "ePendidikan");

    const tglDate = f.tgl ? new Date(f.tgl) : null;
    if (!tglDate || isNaN(tglDate) || tglDate > new Date()) bad("fTgl", "eTgl", "Tanggal lahir tidak valid.");
    else if (hitungUmur(f.tgl) > MAX_UMUR) bad("fTgl", "eTgl", `Usia maksimal ${MAX_UMUR} tahun. Anda tidak dapat mengajukan lamaran.`);
    else ok("fTgl", "eTgl");

    if (!/^0\d{9,12}$/.test(f.telp)) bad("fTelp", "eTelp", "No Telp harus diawali 0 dan 10-13 digit.");
    else ok("fTelp", "eTelp");

    if (!f.pernah) { setError("ePernah", "Pilih salah satu."); if (!firstBad) firstBad = "lblPernahYa"; }
    else setError("ePernah", "");
    if (f.pernah === "ya" && f.descPernah.length < 5) bad("fDescPernah", "eDescPernah", "Wajib dijelaskan.");
    else ok("fDescPernah", "eDescPernah");

    if (!f.info) bad("fInfo", "eInfo", "Pilih sumber informasi."); else ok("fInfo", "eInfo");

    if (f.info === INFO_KERABAT) {
        if (!f.referensi) bad("fReferensi", "eReferensi", "Wajib diisi."); else ok("fReferensi", "eReferensi");
        if (f.descReferensi.length < 5) bad("fDescReferensi", "eDescReferensi", "Wajib dijelaskan."); else ok("fDescReferensi", "eDescReferensi");
    }

    if (f.pungli === "ya" && f.descPungli.length < 3) bad("fDescPungli", "eDescPungli", "Wajib dijelaskan.");
    else ok("fDescPungli", "eDescPungli");

    if (firstBad) {
        const el = $(firstBad);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        return false;
    }
    return true;
}

// ===================================================
// KELOMPOK 9: REVIEW (TAHAP 4)
// Fungsi: menampilkan ringkasan semua isian sebelum dikirim.
// ===================================================
function renderReview() {
    const f = readForm();
    const tglTxt = f.tgl ? f.tgl.split("-").reverse().join("/") : "-";
    const rows = [
        ["No KTP", formatKtp(f.ktp)],
        ["Nama", f.nama],
        ["Alamat", f.alamat],
        ["Jenis Kelamin", f.jk],
        ["Pendidikan Terakhir", f.pendidikan],
        ["Tanggal Lahir", tglTxt],
        ["No Telp", formatTelp(f.telp)],
        ["Pernah bekerja di DMB", f.pernah === "ya" ? "Ya" : "Tidak"]
    ];
    if (f.pernah === "ya") rows.push(["Keterangan pernah bekerja", f.descPernah]);
    rows.push(["Sumber informasi lamaran", f.info]);
    if (f.info === INFO_KERABAT) {
        rows.push(["Yang mereferensikan", f.referensi]);
        rows.push(["Hubungan & pekerjaan referensi", f.descReferensi]);
    }
    rows.push(["Diharuskan memberi uang/barang", f.pungli === "ya" ? "Ya" : "Tidak"]);
    if (f.pungli === "ya") rows.push(["Yang diberikan", f.descPungli]);

    $("reviewBody").innerHTML = rows
        .map(r => `<tr><td>${esc(r[0])}</td><td>${esc(r[1] || "-")}</td></tr>`).join("");
    $("alertSubmit").hidden = true;
}

// ===================================================
// KELOMPOK 10: KIRIM DATA
// Fungsi: kirim lewat fungsi database public.kirim_lamaran_borongan.
// Database memeriksa ulang semua aturan (KTP ganda, status pernah karyawan,
// kolom wajib). Setelah sukses, SEMUA data session storage dihapus.
// ===================================================
async function submitForm() {
    if (state.sending) return;
    const f = readForm();
    const payload = {
        nik_ktp: f.ktp,
        nama: f.nama,
        alamat: f.alamat,
        jenis_kelamin: f.jk,
        pendidikan: f.pendidikan,
        tanggal_lahir: f.tgl,
        no_telp: f.telp,
        pernah_di_dmb: f.pernah === "ya",
        deskripsi_pernah_di_dmb: f.pernah === "ya" ? f.descPernah : null,
        info_loker: f.info,
        referensi: f.info === INFO_KERABAT ? f.referensi : null,
        deskripsi_referensi: f.info === INFO_KERABAT ? f.descReferensi : null,
        is_pungli: f.pungli === "ya",
        deskripsi_is_pungli: f.pungli === "ya" ? f.descPungli : null
    };

    state.sending = true;
    $("btnNext").disabled = true;
    $("btnBack").disabled = true;
    $("btnNext").textContent = "Mengirim...";
    $("alertSubmit").hidden = true;

    try {
        const { data, error } = await supabaseClient.rpc(RPC_KIRIM, { p: payload });
        if (error) throw error;
        if (data && data.success === false) throw new Error(data.message || "Gagal menyimpan.");

        // Sukses: hapus seluruh sesi session storage, tampilkan layar selesai
        clearDraft();
        for (let i = 1; i <= TOTAL_STEPS; i++) $("panel" + i).hidden = true;
        $("lkSteps").hidden = true;
        $("lkNav").hidden = true;
        $("panelDone").hidden = false;
        window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
        console.error("Gagal kirim lamaran:", err);
        const box = $("alertSubmit");
        box.textContent = "Lamaran belum terkirim. " + (err.message || "Coba lagi.");
        box.hidden = false;
        // Jika ditolak karena KTP sudah terdaftar, kunci form
        if (/sudah tersimpan/i.test(err.message || "")) state.ktpAktif = true;
        if (/blacklist/i.test(err.message || "")) state.ktpBlacklist = true;
    } finally {
        state.sending = false;
        $("btnBack").disabled = false;
        $("btnNext").textContent = "Kirim Lamaran";
        updateNextState();
    }
}

// ===================================================
// KELOMPOK 11: INISIALISASI
// Fungsi: memasang semua kejadian lalu memulihkan draft (jika ada).
// ===================================================
document.addEventListener("DOMContentLoaded", () => {
    // Batas tanggal lahir: tidak boleh melewati hari ini
    const now = new Date();
    $("fTgl").max = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

    loadDraft();

    $("btnNext").addEventListener("click", onNext);
    $("btnBack").addEventListener("click", onBack);

    $("chkAgree").addEventListener("change", (e) => {
        state.agree = e.target.checked;
        updateNextState();
        saveDraft();
    });

    $("fKtp").addEventListener("input", onKtpInput);
    $("fTelp").addEventListener("input", () => { $("fTelp").value = formatTelp($("fTelp").value); });
    $("fInfo").addEventListener("change", applyConditional);
    document.querySelectorAll('input[name="pernah"], input[name="pungli"]').forEach(r => r.addEventListener("change", applyConditional));

    // Simpan draft setiap ada perubahan isian
    $("panel3").addEventListener("input", saveDraft);
    $("panel3").addEventListener("change", saveDraft);

    applyConditional();
    // Jika draft berisi KTP lengkap, cek ulang status-nya
    const d = digits($("fKtp").value);
    if (d.length === 16) cekKtp(d);

    showStep(state.step);
});