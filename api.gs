// =============================================================================
// api.gs  -  PINTU API UNTUK FRONTEND DI GITHUB PAGES
// Tambahkan sebagai FILE BARU di project Apps Script yang sama dengan code.gs.
//
// SATU PERUBAHAN WAJIB di code.gs:
//   ganti baris   function doGet(e) {
//   menjadi       function doGetLama_(e) {
// (supaya tidak bentrok dengan doGet baru di bawah; endpoint publik ?act=tunggakan tetap jalan)
// =============================================================================

// Daftar fungsi yang boleh dipanggil dari browser. Fungsi di luar daftar ini TIDAK bisa diakses.
// Dibuat di dalam fungsi agar tidak bergantung pada urutan pemuatan file.
function apiRoutes_() {
  return {
    // autentikasi
    loginAdmin: loginAdmin,
    logoutAdmin: logoutAdmin,
    // ringkasan & dashboard
    getJumlahSantriRingkasan: getJumlahSantriRingkasan,
    getSummaryKasSetoran: getSummaryKasSetoran,
    getAkumulasiTunggakan: getAkumulasiTunggakan,
    getPersentasePembayaran: getPersentasePembayaran,
    getDashboardData: getDashboardData,
    updateStatusMenunggakOtomatis: updateStatusMenunggakOtomatis,
    // dropdown & tarif
    getDaftarKelas: getDaftarKelas,
    getDaftarNamaSantriByKelas: getDaftarNamaSantriByKelas,
    getTarifSantri: getTarifSantri,
    // simpan / hapus
    simpanSantri: simpanSantri,
    simpanSPP: simpanSPP,
    simpanKostDapur: simpanKostDapur,
    simpanDaftarUlang: simpanDaftarUlang,
    simpanSetoran: simpanSetoran,
    hapusData: hapusData,
    // tagihan masal & aksi per kelas
    generateTagihanSPPMasal: generateTagihanSPPMasal,
    generateTagihanKDMasal: generateTagihanKDMasal,
    generateTagihanDUMasal: generateTagihanDUMasal,
    hitungAksiMasal: hitungAksiMasal,
    aksiMasalKelas: aksiMasalKelas,
    // reset, impor, ekspor
    resetTahunAjaranBaru: resetTahunAjaranBaru,
    importDataSantri: importDataSantri,
    exportDataSantri: exportDataSantri,
    hapusSeluruhSantri: hapusSeluruhSantri,
    // kwitansi & WhatsApp
    buatKwitansiPDF: buatKwitansiPDF,
    getDaftarPengingat: getDaftarPengingat,
    // NIS
    getStatusNIS: getStatusNIS,
    hubungkanNIS: hubungkanNIS,
    getDaftarNisGanda: getDaftarNisGanda,
    ubahNisGanda: ubahNisGanda,
    getTransaksiTanpaNis: getTransaksiTanpaNis,
    hubungkanTrxBanyak: hubungkanTrxBanyak
  };
}

// Frontend mengirim: { fn: "namaFungsi", args: [token, ...] } sebagai teks (text/plain)
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    const fn = String(body.fn || '');
    const args = Array.isArray(body.args) ? body.args : [];
    const routes = apiRoutes_();
    if (!Object.prototype.hasOwnProperty.call(routes, fn)) {
      return json_({ ok: false, error: 'Fungsi tidak dikenal: ' + fn });
    }
    const data = routes[fn].apply(null, args);
    return json_({ ok: true, data: data === undefined ? null : data });
  } catch (err) {
    // requireAuth_ melempar Error('SESI_HABIS') -> frontend otomatis kembali ke halaman login
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

// GET: endpoint publik tunggakan tetap dilayani fungsi lama; selain itu hanya penanda "API hidup".
function doGet(e) {
  if (e && e.parameter && e.parameter.act === 'tunggakan') return doGetLama_(e);
  return json_({ ok: true, service: 'Virtual Office Darul Amien API', waktu: new Date().toISOString() });
}
