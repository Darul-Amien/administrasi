let pendingAction = null;
let passModalObj = null;
let chartSPPObj = null;
let chartKDObj = null;
let SESSION_TOKEN = sessionStorage.getItem('adminToken') || '';
let ROWS = {};

function rp(v) {
  const s = String(v == null ? '' : v).trim();
  if (s === '') return '<span class="text-muted">Standar</span>';
  const n = Number(s.replace(/\D/g, ''));
  return n > 0 ? 'Rp ' + n.toLocaleString('id-ID') : '<span class="badge bg-warning text-dark">Gratis</span>';
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sesiHabis() {
  sessionStorage.removeItem('adminToken'); SESSION_TOKEN = '';
  checkSessionLogin();
  const a = document.getElementById('loginAlert');
  a.innerText = 'Sesi berakhir, silakan login kembali.';
  a.classList.remove('d-none');
}

// -----------------------------------------------------------------------------
// ADAPTER BACKEND: menggantikan google.script.run dengan fetch ke Web App Apps Script.
// Antarmukanya sengaja sama: api().withSuccessHandler(fn).withFailureHandler(fn).namaFungsi(...)
// Token sesi otomatis disisipkan sebagai argumen pertama (kecuali loginAdmin).
// -----------------------------------------------------------------------------
const API_TIMEOUT_MS = 120000;   // 2 menit (kwitansi PDF & aksi massal bisa agak lama)

async function callApi(fn, args) {
  if (!window.API_URL || window.API_URL.indexOf('GANTI_') >= 0) {
    throw new Error('API_URL belum diisi. Edit config.js lalu isi dengan URL Web App Apps Script (berakhiran /exec).');
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), API_TIMEOUT_MS);
  try {
    // text/plain = "simple request": tidak memicu preflight CORS yang tidak didukung Apps Script
    const res = await fetch(window.API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args }),
      redirect: 'follow',
      signal: ctl.signal
    });
    const text = await res.text();
    let out;
    try { out = JSON.parse(text); }
    catch (e) { throw new Error('Respons server tidak valid (HTTP ' + res.status + '). Pastikan Web App di-deploy dengan akses "Anyone" dan URL-nya benar.'); }
    if (!out.ok) throw new Error(out.error || 'Terjadi kesalahan di server');
    return out.data;
  } catch (err) {
    if (err && err.name === 'AbortError') throw new Error('Server terlalu lama merespons. Coba lagi.');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function api() {
  const isHabis = (err) => String((err && err.message) || err).includes('SESI_HABIS');
  const state = { ok: null, fail: null };
  const gagalDefault = (err) => showAlert('Error: ' + ((err && err.message) || err), false);
  const builder = new Proxy({}, {
    get(_t, p) {
      if (typeof p !== 'string') return undefined;
      if (p === 'withSuccessHandler') return (fn) => { state.ok = fn; return builder; };
      if (p === 'withFailureHandler') return (fn) => { state.fail = fn; return builder; };
      return (...a) => {
        const args = p === 'loginAdmin' ? a : [SESSION_TOKEN, ...a];
        callApi(p, args).then(
          (r) => { if (state.ok) state.ok(r); },
          (err) => { if (isHabis(err)) return sesiHabis(); (state.fail || gagalDefault)(err); }
        );
      };
    }
  });
  return builder;
}

// Aksi tombol tabel: data diambil dari ROWS (aman untuk nama berapostrof, tanpa HTML inline)
function act(t, i, mode) {
  const r = ROWS[t][i]; if (!r) return;
  const rf = r[r.length - 1] + '|' + r[0];   // "nomor baris|kunci" untuk verifikasi di server
  if (mode === 'kwi') return unduhKwitansi(t.toUpperCase(), rf);
  if (mode === 'wa') return bukaPengingatWA(r[0]);
  if (mode === 'del') {
    const sheetName = { santri: 'DataSantri', spp: 'Keuangan_SPP', kd: 'Keuangan_KostDapur', du: 'Keuangan_DaftarUlang', setor: 'Keuangan_Setoran' }[t];
    return promptHapus(sheetName, rf);
  }
  if (t === 'santri') editSantri(rf, r[0], r[1], String(r[2]).replace(/^kelas\s+/i, '').trim(), r[3], r[4], r[5], r[6], r[7], r[8], r[9]);
  else if (t === 'spp') editSPP(rf, r[2], r[4], r[5], r[6]);
  else if (t === 'kd') editKostDapur(rf, r[6], r[3], r[4], r[5]);
  else if (t === 'du') editDaftarUlang(rf, r[6], r[3], r[4], r[5]);
}

document.addEventListener("DOMContentLoaded", () => {
  passModalObj = new bootstrap.Modal(document.getElementById('passModal'));
  document.getElementById('adminPasswordInput').addEventListener('keydown', e => { if (e.key === 'Enter') executePendingAction(); });
  ['btnSantri', 'btnSPP', 'btnKD', 'btnDU', 'btnSetor'].forEach(id => { const b = document.getElementById(id); if (b) b.dataset.lbl = b.innerText; });
  checkSessionLogin();
  // Pilih santri -> nominal terisi otomatis sesuai tarif santri tersebut (hanya untuk transaksi baru)
  ['spp', 'kd', 'du'].forEach(k => document.getElementById(k + 'Santri').addEventListener('change', function () {
    if (document.getElementById(k + 'RowId').value || !this.value) return;
    const nom = document.getElementById(k + 'Nominal');
    nom.value = ''; nom.placeholder = 'memuat tarif...';
    api().withSuccessHandler(t => { nom.value = t[k]; nom.placeholder = ''; })
         .withFailureHandler(() => { nom.placeholder = 'isi nominal manual'; })
         .getTarifSantri(this.value);
  }));
});

// -----------------------------------------------------------------------------
// MANAJEMEN AUTENTIKASI LOGIN
// -----------------------------------------------------------------------------

function checkSessionLogin() {
  const isLoggedIn = SESSION_TOKEN ? "true" : "";
  const loginBox = document.getElementById("loginContainer");
  const dashBox = document.getElementById("mainDashboardContainer");

  if (isLoggedIn === "true") {
    loginBox.classList.add("d-none");
    dashBox.classList.remove("d-none");
    initDashboard();
  } else {
    loginBox.classList.remove("d-none");
    dashBox.classList.add("d-none");
  }
}

function handleLoginSubmit(e) {
  e.preventDefault();
  const u = document.getElementById("loginUsername").value.trim();
  const p = document.getElementById("loginPassword").value;
  const btn = document.getElementById("btnLogin");
  const alertBox = document.getElementById("loginAlert");

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Memeriksa...';
  alertBox.classList.add("d-none");

  api()
    .withSuccessHandler((res) => {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Masuk Dashboard';

      if (res.success) {
        SESSION_TOKEN = res.token; sessionStorage.setItem("adminToken", res.token);
        checkSessionLogin();
      } else {
        alertBox.innerText = res.message;
        alertBox.classList.remove("d-none");
      }
    })
    .withFailureHandler((err) => {
      btn.disabled = false;
      btn.innerHTML = '<i class="bi bi-box-arrow-in-right"></i> Masuk Dashboard';
      alertBox.innerText = "Error: " + err.message;
      alertBox.classList.remove("d-none");
    })
    .loginAdmin(u, p);
}

function handleLogout() {
  if (confirm("Apakah Anda yakin ingin keluar dari sistem?")) {
    api().logoutAdmin(); sessionStorage.removeItem("adminToken"); SESSION_TOKEN = '';
    document.getElementById("loginUsername").value = '';
    document.getElementById("loginPassword").value = '';
    checkSessionLogin();
  }
}

// -----------------------------------------------------------------------------
// DASHBOARD & DATA FLOW
// -----------------------------------------------------------------------------

function initDashboard() {
  loadDashboard();
  loadKelasDropdown();
  loadTunggakan();
  loadKasSummary();
  loadChartPersentase();
  loadJumlahSantri();
  loadStatusNIS();
}

function loadStatusNIS() {
  api().withSuccessHandler((r) => {
    const box = document.getElementById('bannerNIS'), tk = document.getElementById('bannerNISteks'), btn = document.getElementById('btnHubungkanNIS');
    if (!r || !r.success || (!r.santriTanpaNis && !r.nisGanda && !r.trxTanpaNis)) { box.classList.add('d-none'); return; }
    const msg = [];
    if (r.santriTanpaNis) msg.push(`${r.santriTanpaNis} santri belum punya NIS (edit santri lalu isi NIS)`);
    if (r.nisGanda) msg.push(`${r.nisGanda} NIS ganda`);
    if (r.trxTanpaNis) msg.push(`${r.trxTanpaNis} transaksi belum terhubung ke NIS`);
    tk.innerHTML = '<i class="bi bi-exclamation-triangle-fill"></i> <b>Perlu perhatian:</b> ' + esc(msg.join(' · '));
    btn.classList.toggle('d-none', !(r.trxTanpaNis && !r.santriTanpaNis && !r.nisGanda));
    document.getElementById('btnLihatGanda').classList.toggle('d-none', !r.nisGanda);
    document.getElementById('btnRapikanTrx').classList.toggle('d-none', !r.trxTanpaNis);
    box.classList.remove('d-none');
  }).getStatusNIS();
}

function hubungkanNIS() {
  pendingAction = () => {
    const pass = document.getElementById('adminPasswordInput').value;
    api().withSuccessHandler((res) => {
      showAlert(res.message, res.success);
      initDashboard();
    }).hubungkanNIS(pass);
  };
  document.getElementById('adminPasswordInput').value = '';
  passModalObj.show();
}

function loadJumlahSantri() {
  api().withSuccessHandler((res) => {
    if (res.success) {
      document.getElementById('statTotalSantri').innerText = res.total + ' Santri';
      document.getElementById('badgeSantriDetail').innerText = `Aktif: ${res.aktif} | Tunggak: ${res.menunggak} | Off: ${res.nonAktif}`;
    }
  }).getJumlahSantriRingkasan();
}

function syncStatusSantri() {
  api().withSuccessHandler((res) => {
    showAlert(res.message || 'Status santri berhasil disinkronisasi', true);
    initDashboard();
  }).updateStatusMenunggakOtomatis();
}

function toggleFilterTunggakanBox() {
  const el = document.getElementById('boxFilterTunggakan');
  el.classList.toggle('d-none');
}

function onJenisTunggakanChange() {
  const jenis = document.getElementById('fltJenisTunggakan').value;
  const grpSPP = document.getElementById('grpFilterSPP');
  const grpKD = document.getElementById('grpFilterKD');

  grpSPP.classList.toggle('d-none', jenis === 'KD' || jenis === 'DU');
  grpKD.classList.toggle('d-none', jenis === 'SPP' || jenis === 'DU');
  loadTunggakan();
}

function resetFilterTunggakan() {
  document.getElementById('fltJenisTunggakan').value = 'SEMUA';
  document.getElementById('fltSPPDari').value = 'Juli';
  document.getElementById('fltSPPSampai').value = 'Juni';
  document.getElementById('fltKDDariBulan').value = 'Juli';
  document.getElementById('fltKDDariPekan').value = 'Pekan 1';
  document.getElementById('fltKDSampaiBulan').value = 'Juni';
  document.getElementById('fltKDSampaiPekan').value = 'Pekan 5';
  onJenisTunggakanChange();
}

function loadTunggakan() {
  const filterTunggakan = {
    jenis: document.getElementById('fltJenisTunggakan').value,
    sppDari: document.getElementById('fltSPPDari').value,
    sppSampai: document.getElementById('fltSPPSampai').value,
    kdDariBulan: document.getElementById('fltKDDariBulan').value,
    kdDariPekan: document.getElementById('fltKDDariPekan').value,
    kdSampaiBulan: document.getElementById('fltKDSampaiBulan').value,
    kdSampaiPekan: document.getElementById('fltKDSampaiPekan').value
  };

  api().withSuccessHandler((res) => {
    if (res.success) {
      document.getElementById('statTunggakan').innerText = 'Rp ' + Number(res.totalGabunganRp).toLocaleString('id-ID');
      
      const j = res.jenisTerpilih, b = [];
      if (j === 'SEMUA' || j === 'SPP') b.push(`SPP: ${res.spp.jumlahTransaksi} Trx`);
      if (j === 'SEMUA' || j === 'KD') b.push(`KD: ${res.kostDapur.jumlahTransaksi} Trx`);
      if (j === 'SEMUA' || j === 'DU') b.push(`DU: ${res.daftarUlang.jumlahTransaksi} Trx`);
      document.getElementById('badgeTunggakanDetail').innerText = b.join(' | ');
    }
  }).getAkumulasiTunggakan(filterTunggakan);
}

function triggerResetTahunAjaran() {
  if (!confirm("APAKAH ANDA YAKIN?\n\nTindakan ini akan mengosongkan seluruh riwayat SPP, Kost Dapur, Daftar Ulang, dan Buku Setoran untuk memulai tahun ajaran baru!")) {
    return;
  }
  
  pendingAction = () => {
    const pass = document.getElementById('adminPasswordInput').value;
    api().withSuccessHandler((res) => {
      showAlert(res.message, res.success);
      if (res.success) initDashboard();
    }).resetTahunAjaranBaru(pass);
  };
  
  document.getElementById('adminPasswordInput').value = '';
  passModalObj.show();
}

function onAksiJenisChange() {
  const j = document.getElementById('aksiJenis').value;
  document.getElementById('grpAksiPekan').classList.toggle('d-none', j !== 'KD');
  document.getElementById('grpAksiPeriode').classList.toggle('d-none', j !== 'DU');
  document.getElementById('aksiBulan').parentElement.classList.toggle('d-none', j === 'DU');
}

function jalankanAksiMasal() {
  const p = {
    jenis: document.getElementById('aksiJenis').value,
    kelas: document.getElementById('aksiKelas').value,
    bulan: document.getElementById('aksiBulan').value,
    pekan: document.getElementById('aksiPekan').value,
    periode: document.getElementById('aksiPeriode').value,
    aksi: document.getElementById('aksiTipe').value
  };
  api().withSuccessHandler((res) => {
    if (!res.success) return showAlert(res.message, false);
    if (res.jumlah === 0) return showAlert('Tidak ada tagihan Belum Lunas yang cocok.', false);
    const nama = ({ KD: 'Kost Dapur ', DU: 'Daftar Ulang ', SPP: 'SPP ' }[p.jenis]) + res.label + ' Kelas ' + p.kelas;
    const teks = p.aksi === 'HAPUS'
      ? 'HAPUS ' + res.jumlah + ' tagihan ' + nama + '?\n\nTagihan yang dihapus tidak dihitung sebagai tunggakan dan tidak bisa dikembalikan (kecuali dibuat ulang lewat Tagihan Masal).'
      : 'TANDAI LUNAS ' + res.jumlah + ' tagihan ' + nama + '?\n\nPerhatian: ini dicatat sebagai uang yang sudah diterima dan akan menambah Total Pendapatan / Cash di Tangan. Jika santri hanya tidak wajib membayar, gunakan aksi Hapus tagihan.';
    if (!confirm(teks)) return;
    pendingAction = () => {
      const pass = document.getElementById('adminPasswordInput').value;
      api().withSuccessHandler((r) => {
        showAlert(r.message, r.success);
        if (r.success) initDashboard();
      }).aksiMasalKelas(p, pass);
    };
    document.getElementById('adminPasswordInput').value = '';
    passModalObj.show();
  }).hitungAksiMasal(p);
}

function triggerGenTagihan(type) {
  if (type === 'SPP') {
    const bulan = document.getElementById('genBulan').value;
    pendingAction = () => {
      const pass = document.getElementById('adminPasswordInput').value;
      api().withSuccessHandler((res) => {
        showAlert(res.message, res.success);
        if (res.success) initDashboard();
      }).generateTagihanSPPMasal(bulan, pass);
    };
  } else if (type === 'KD') {
    const bulan = document.getElementById('genKDBulan').value;
    const pekan = document.getElementById('genPekan').value;
    pendingAction = () => {
      const pass = document.getElementById('adminPasswordInput').value;
      api().withSuccessHandler((res) => {
        showAlert(res.message, res.success);
        if (res.success) initDashboard();
      }).generateTagihanKDMasal(bulan, pekan, pass);
    };
  } else if (type === 'DU') {
    const periode = document.getElementById('genDUPeriode').value.trim();
    if (!periode) return showAlert('Isi tahun ajaran dulu (mis. 2026/2027).', false);
    pendingAction = () => {
      const pass = document.getElementById('adminPasswordInput').value;
      api().withSuccessHandler((res) => {
        showAlert(res.message, res.success);
        if (res.success) initDashboard();
      }).generateTagihanDUMasal(periode, pass);
    };
  }
  
  document.getElementById('adminPasswordInput').value = '';
  passModalObj.show();
}

function loadKelasDropdown(callback) {
  api().withSuccessHandler((listKelas) => {
    const sppKelas = document.getElementById('sppKelasFilter');
    const kdKelas = document.getElementById('kdKelasFilter');
    const tableKelas = document.getElementById('tableKelasFilter');
    
    if (!sppKelas || !kdKelas) return;

    sppKelas.innerHTML = '';
    kdKelas.innerHTML = '';
    if (tableKelas) tableKelas.innerHTML = '';

    let options = '<option value="">-- Semua Kelas --</option>';
    let tableOptions = '<option value="SEMUA">-- Filter Per Kelas --</option>';
    let aksiOptions = '<option value="">-- Pilih Kelas --</option>';
    
    listKelas.forEach(k => {
      const cleanName = String(k).replace(/^kelas\s+/i, '').trim();
      options += `<option value="${esc(cleanName)}">Kelas ${esc(cleanName)}</option>`;
      tableOptions += `<option value="${esc(cleanName)}">Kelas ${esc(cleanName)}</option>`;
      aksiOptions += `<option value="${esc(cleanName)}">Kelas ${esc(cleanName)}</option>`;
    });
    
    sppKelas.innerHTML = options;
    kdKelas.innerHTML = options;
    const duKelas = document.getElementById('duKelasFilter'); if (duKelas) duKelas.innerHTML = options;
    if (tableKelas) tableKelas.innerHTML = tableOptions;
    const aksiEl = document.getElementById('aksiKelas');
    if (aksiEl) { const keep = aksiEl.value; aksiEl.innerHTML = aksiOptions; aksiEl.value = keep; }

    const kelSel = document.getElementById('kelas');
    if (kelSel) { const keep = kelSel.value; kelSel.innerHTML = listKelas.map(k => { const c = esc(String(k).replace(/^kelas\s+/i, '').trim()); return `<option value="${c}">Kelas ${c}</option>`; }).join(''); kelSel.value = keep; }
    onKelasChange('sppKelasFilter', 'sppSantri');
    onKelasChange('kdKelasFilter', 'kdSantri', callback);
    onKelasChange('duKelasFilter', 'duSantri');
  }).getDaftarKelas();
}

function onKelasChange(kelasSelectId, santriSelectId, callback) {
  const selectedKelas = document.getElementById(kelasSelectId).value;
  api().withSuccessHandler((listNama) => {
    SANTRI_CACHE[santriSelectId] = listNama || [];
    renderSantriOptions(santriSelectId);
    if (typeof callback === 'function') callback();
  }).getDaftarNamaSantriByKelas(selectedKelas);
}

function loadKasSummary() {
  api().withSuccessHandler((res) => {
    if (res.success) {
      document.getElementById('statCashDiTangan').innerText = 'Rp ' + Number(res.sisaCash).toLocaleString('id-ID');
      document.getElementById('statTotalSetoran').innerText = 'Rp ' + Number(res.totalSetoran).toLocaleString('id-ID');
    }
  }).getSummaryKasSetoran();
}

function loadChartPersentase() {
  api().withSuccessHandler((res) => {
    if (res.error) return;

    const ctxSPP = document.getElementById('chartSPP').getContext('2d');
    if (chartSPPObj) chartSPPObj.destroy();
    chartSPPObj = new Chart(ctxSPP, {
      type: 'doughnut',
      data: {
        labels: ['Lunas', 'Menunggak'],
        datasets: [{
          data: [res.spp.percentLunas, res.spp.percentMenunggak],
          backgroundColor: ['#198754', '#dc3545']
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });

    const ctxKD = document.getElementById('chartKD').getContext('2d');
    if (chartKDObj) chartKDObj.destroy();
    chartKDObj = new Chart(ctxKD, {
      type: 'doughnut',
      data: {
        labels: ['Lunas', 'Menunggak'],
        datasets: [{
          data: [res.kostDapur.percentLunas, res.kostDapur.percentMenunggak],
          backgroundColor: ['#ffc107', '#dc3545']
        }]
      },
      options: { responsive: true, maintainAspectRatio: false }
    });
  }).getPersentasePembayaran();
}

function loadDashboard() {
  const filterOptions = {
    searchKey: document.getElementById('searchKeyword').value,
    status: document.getElementById('statusFilter').value,
    kelas: document.getElementById('tableKelasFilter') ? document.getElementById('tableKelasFilter').value : 'SEMUA'
  };

  api()
    .withSuccessHandler(renderDashboard)
    .withFailureHandler((err) => showAlert('Gagal memuat data: ' + err.message, false))
    .getDashboardData(filterOptions);
}

function renderDashboard(data) {
  if (data && data.error) return showAlert('System Error: ' + data.error, false);
  ROWS = { santri: data.santri || [], spp: data.spp || [], kd: data.kostDapur || [], du: data.daftarUlang || [], setor: data.setoran || [] };

  renderTable('tblSantri', data.santri, (r, i) => {
    const rowId = r[r.length - 1];
    let badgeClass = 'bg-success';
    if (r[6] === 'Menunggak') badgeClass = 'bg-danger';
    if (r[6] === 'Non-Aktif') badgeClass = 'bg-secondary';
    const displayKelas = String(r[2]).replace(/^kelas\s+/i, '').trim();

    return `
      <tr>
        <td><b>${esc(r[0])}</b></td>
        <td>${esc(r[1])}</td>
        <td><span class="badge bg-secondary">Kelas ${esc(displayKelas)}</span></td>
        <td>${esc(r[3])}</td>
        <td>${esc(r[4])}</td>
        <td>${esc(r[5])}</td>
        <td><span class="badge ${badgeClass}">${esc(r[6])}</span></td>
        <td>${rp(r[7])}</td>
        <td>${rp(r[8])}</td>
        <td>${rp(r[9])}</td>
        <td class="no-print">
          <button class="btn btn-outline-success btn-sm py-0 px-1" title="Pengingat WhatsApp" onclick="act('santri', ${i}, 'wa')"><i class="bi bi-whatsapp"></i></button>
          <button class="btn btn-outline-warning btn-sm py-0 px-1" onclick="act('santri', ${i}, 'edit')"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-outline-danger btn-sm py-0 px-1" onclick="act('santri', ${i}, 'del')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
  });

  renderTable('tblSPP', data.spp, (r, i) => {
    const rowId = r[r.length - 1];
    const isLunas = (r[6] || '').toUpperCase() === 'LUNAS';

    return `
      <tr>
        <td><code>${esc(r[0])}</code></td>
        <td>${esc(r[1])}</td>
        <td>${esc(r[2] || '-')}</td>
        <td><b>${esc(r[3])}</b></td>
        <td>${esc(r[4])}</td>
        <td>Rp ${Number(r[5] || 0).toLocaleString('id-ID')}</td>
        <td><span class="badge ${isLunas ? 'bg-success' : 'bg-danger'}">${esc(r[6] || 'Belum Lunas')}</span></td>
        <td class="no-print">
          ${isLunas ? kwiBtn('spp', i) : ''}
          <button class="btn btn-outline-warning btn-sm py-0 px-1" onclick="act('spp', ${i}, 'edit')"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-outline-danger btn-sm py-0 px-1" onclick="act('spp', ${i}, 'del')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
  });

  renderTable('tblKD', data.kostDapur, (r, i) => {
    const rowId = r[r.length - 1];
    const isLunas = (r[5] || '').toUpperCase() === 'LUNAS';

    return `
      <tr>
        <td><code>${esc(r[0])}</code></td>
        <td>${esc(r[1])}</td>
        <td>${esc(r[6] || '-')}</td>
        <td><b>${esc(r[2])}</b></td>
        <td><span class="badge bg-info text-dark">${esc(r[3])}</span></td>
        <td>Rp ${Number(r[4] || 0).toLocaleString('id-ID')}</td>
        <td><span class="badge ${isLunas ? 'bg-success' : 'bg-danger'}">${esc(r[5] || 'Belum Lunas')}</span></td>
        <td class="no-print">
          ${isLunas ? kwiBtn('kd', i) : ''}
          <button class="btn btn-outline-warning btn-sm py-0 px-1" onclick="act('kd', ${i}, 'edit')"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-outline-danger btn-sm py-0 px-1" onclick="act('kd', ${i}, 'del')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
  });

  renderTable('tblDU', data.daftarUlang, (r, i) => {
    const isLunas = (r[5] || '').toUpperCase() === 'LUNAS';
    return `
      <tr>
        <td><code>${esc(r[0])}</code></td>
        <td>${esc(r[1])}</td>
        <td>${esc(r[6] || '-')}</td>
        <td><b>${esc(r[2])}</b></td>
        <td><span class="badge bg-info text-dark">${esc(r[3])}</span></td>
        <td>Rp ${Number(r[4] || 0).toLocaleString('id-ID')}</td>
        <td><span class="badge ${isLunas ? 'bg-success' : 'bg-danger'}">${esc(r[5] || 'Belum Lunas')}</span></td>
        <td class="no-print">
          ${isLunas ? kwiBtn('du', i) : ''}
          <button class="btn btn-outline-warning btn-sm py-0 px-1" onclick="act('du', ${i}, 'edit')"><i class="bi bi-pencil"></i></button>
          <button class="btn btn-outline-danger btn-sm py-0 px-1" onclick="act('du', ${i}, 'del')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
  });

  renderTable('tblSetor', data.setoran, (r, i) => {
    const rowId = r[r.length - 1];
    return `
      <tr>
        <td><code>${esc(r[0])}</code></td>
        <td>${esc(r[1])}</td>
        <td><b class="text-success">Rp ${Number(r[2] || 0).toLocaleString('id-ID')}</b></td>
        <td><b>${esc(r[3])}</b></td>
        <td>${esc(r[4])}</td>
        <td class="no-print">
          <button class="btn btn-outline-danger btn-sm py-0 px-1" onclick="act('setor', ${i}, 'del')"><i class="bi bi-trash"></i></button>
        </td>
      </tr>`;
  });
}

function renderTable(elementId, rows, rowTemplate) {
  const tbody = document.getElementById(elementId);
  if (!rows || rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="' + (tbody.closest('table').querySelectorAll('thead th').length || 8) + '" class="text-center text-muted py-3">Tidak ada data ditemukan</td></tr>';
  } else {
    tbody.innerHTML = rows.map(rowTemplate).join('');
  }
  labelTable(tbody.closest('table'));
}

function triggerPasswordModal(e, backendFunc, formId, btnId) {
  e.preventDefault();
  // Pembayaran BARU (SPP / Kost Dapur / Daftar Ulang / Setoran) tidak perlu password.
  // Mengubah transaksi yang sudah ada, data santri, dan hapus tetap minta password.
  const rowIdEl = { formSPP: 'sppRowId', formKD: 'kdRowId', formDU: 'duRowId' }[formId];
  const tanpaPassword = formId === 'formSetor' || (!!rowIdEl && !document.getElementById(rowIdEl).value);
  pendingAction = () => {
    const pass = tanpaPassword ? '' : document.getElementById('adminPasswordInput').value;
    const btn = document.getElementById(btnId);
    btn.disabled = true;

    let data = {};
    if (formId === 'formSantri') {
      data = {
        rowId: document.getElementById('santriRowId').value,
        nama: document.getElementById('nama').value,
        nisn: document.getElementById('nisn').value,
        kelas: document.getElementById('kelas').value,
        kamar: document.getElementById('kamar').value,
        wali: document.getElementById('wali').value,
        nohp: document.getElementById('nohp').value,
        status: document.getElementById('santriStatus').value,
        tarifSpp: document.getElementById('tarifSpp').value,
        tarifKd: document.getElementById('tarifKd').value,
        tarifDu: document.getElementById('tarifDu').value
      };
    } else if (formId === 'formSPP') {
      data = {
        rowId: document.getElementById('sppRowId').value,
        santri: document.getElementById('sppSantri').value,
        bulan: document.getElementById('sppBulan').value,
        nominal: document.getElementById('sppNominal').value,
        status: document.getElementById('sppStatus').value
      };
    } else if (formId === 'formKD') {
      data = {
        rowId: document.getElementById('kdRowId').value,
        santri: document.getElementById('kdSantri').value,
        bulan: document.getElementById('kdBulan').value,
        pekan: document.getElementById('kdPekan').value,
        nominal: document.getElementById('kdNominal').value,
        status: document.getElementById('kdStatus').value
      };
    } else if (formId === 'formDU') {
      data = {
        rowId: document.getElementById('duRowId').value,
        santri: document.getElementById('duSantri').value,
        periode: document.getElementById('duPeriode').value,
        nominal: document.getElementById('duNominal').value,
        status: document.getElementById('duStatus').value
      };
    } else if (formId === 'formSetor') {
      data = {
        nominal: document.getElementById('setorNominal').value,
        penerima: document.getElementById('setorPenerima').value,
        keterangan: document.getElementById('setorKeterangan').value
      };
    }

    api()
      .withSuccessHandler((res) => {
        showAlert(res.message, res.success);
        if (res.success) {
          resetFormBayar_(formId);
          if (formId === 'formSantri') toggleFormSantri(false);
          btn.innerText = btn.dataset.lbl || btn.innerText;
          document.querySelectorAll('input[type="hidden"]').forEach(el => el.value = '');
          initDashboard();
        }
        btn.disabled = false;
      })
      .withFailureHandler((err) => {
        showAlert('Error: ' + err.message, false);
        btn.disabled = false;
      })
      [backendFunc](data, pass);
  };

  if (tanpaPassword) { const aksi = pendingAction; pendingAction = null; aksi(); return; }
  document.getElementById('adminPasswordInput').value = '';
  passModalObj.show();
}

// Setelah simpan: form pembayaran TIDAK dikosongkan semua. Bulan / pekan / tahun ajaran tetap,
// hanya santri yang dikosongkan, supaya input santri berikutnya cepat.
function resetFormBayar_(formId) {
  const k = { formSPP: 'spp', formKD: 'kd', formDU: 'du' }[formId];
  if (!k) { document.getElementById(formId).reset(); return; }
  document.getElementById(k + 'RowId').value = '';
  document.getElementById(k + 'Status').value = 'Lunas';
  document.getElementById(k + 'Nominal').value = '';
  document.getElementById(k + 'Cari').value = '';
  document.getElementById(k + 'Santri').value = '';
  renderSantriOptions(k + 'Santri');
  document.getElementById(k + 'Cari').focus();
}

function promptHapus(sheetName, rowId) {
  pendingAction = () => {
    const pass = document.getElementById('adminPasswordInput').value;
    api()
      .withSuccessHandler((res) => {
        showAlert(res.message, res.success);
        initDashboard();
      })
      .hapusData(sheetName, rowId, pass);
  };
  document.getElementById('adminPasswordInput').value = '';
  passModalObj.show();
}

function executePendingAction() {
  if (pendingAction) {
    passModalObj.hide();
    pendingAction();
    pendingAction = null;
  }
}

function editSantri(rowId, nama, nisn, kelas, kamar, wali, nohp, status, tarifSpp, tarifKd, tarifDu) {
  document.getElementById('santriRowId').value = rowId;
  document.getElementById('nama').value = nama;
  document.getElementById('nisn').value = nisn;
  document.getElementById('kelas').value = kelas;
  document.getElementById('kamar').value = kamar;
  document.getElementById('wali').value = wali;
  document.getElementById('nohp').value = nohp;
  document.getElementById('santriStatus').value = status || 'Aktif';
  document.getElementById('tarifSpp').value = String(tarifSpp || '').replace(/\D/g, '');
  document.getElementById('tarifKd').value = String(tarifKd || '').replace(/\D/g, '');
  document.getElementById('tarifDu').value = String(tarifDu || '').replace(/\D/g, '');
  document.getElementById('btnSantri').innerText = 'Update Santri';
  irKeForm('santri');
}

function editSPP(rowId, santri, bulan, nominal, status) {
  document.getElementById('sppRowId').value = rowId;
  document.getElementById('sppBulan').value = bulan;
  document.getElementById('sppNominal').value = nominal;
  document.getElementById('sppStatus').value = status;
  document.getElementById('sppKelasFilter').value = '';
  
  loadKelasDropdown(() => {
    document.getElementById('sppSantri').value = santri;
  });
  
  document.getElementById('btnSPP').innerText = 'Update SPP';
  irKeForm('spp');
}

function editKostDapur(rowId, santri, pekanLabel, nominal, status) {
  document.getElementById('kdRowId').value = rowId;
  document.getElementById('kdNominal').value = nominal;
  document.getElementById('kdStatus').value = status;
  document.getElementById('kdKelasFilter').value = '';
  
  if (pekanLabel && pekanLabel.includes('-')) {
    const parts = pekanLabel.split('-').map(s => s.trim());
    document.getElementById('kdBulan').value = parts[0] || '';
    document.getElementById('kdPekan').value = parts[1] || 'Pekan 1';
  } else {
    document.getElementById('kdBulan').value = '';
    document.getElementById('kdPekan').value = pekanLabel || 'Pekan 1';
  }

  loadKelasDropdown(() => {
    document.getElementById('kdSantri').value = santri;
  });

  document.getElementById('btnKD').innerText = 'Update Kost Dapur';
  irKeForm('kd');
}

function editDaftarUlang(rowId, santri, periode, nominal, status) {
  document.getElementById('duRowId').value = rowId;
  document.getElementById('duPeriode').value = periode;
  document.getElementById('duNominal').value = nominal;
  document.getElementById('duStatus').value = status;
  document.getElementById('duKelasFilter').value = '';
  onKelasChange('duKelasFilter', 'duSantri', () => { document.getElementById('duSantri').value = santri; });
  document.getElementById('btnDU').innerText = 'Update Daftar Ulang';
  irKeForm('du');
}

// -----------------------------------------------------------------------------
// KWITANSI PDF & PENGINGAT WHATSAPP
// -----------------------------------------------------------------------------

function kwiBtn(t, i) {
  return `<button class="btn btn-outline-success btn-sm py-0 px-1" title="Kwitansi PDF" onclick="act('${t}', ${i}, 'kwi')"><i class="bi bi-file-earmark-pdf"></i></button>`;
}

function unduhKwitansi(jenis, rowRef) {
  showAlert('Menyiapkan kwitansi PDF...', true);
  api().withSuccessHandler((res) => {
    if (!res.success) return showAlert(res.message || 'Gagal membuat kwitansi.', false);
    const bin = atob(res.base64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = res.filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    showAlert('Kwitansi diunduh: ' + res.filename, true);
  }).buatKwitansiPDF(jenis, rowRef);
}

let WA_LIST = [];

function bukaPengingatWA(nama) {
  document.getElementById('waCari').value = nama || '';
  document.getElementById('waKelas').innerHTML = document.getElementById('tableKelasFilter').innerHTML;
  bootstrap.Modal.getOrCreateInstance(document.getElementById('waModal')).show();
  muatPengingatWA();
}

function muatPengingatWA() {
  const body = document.getElementById('waBody');
  body.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-3">Memuat data...</td></tr>';
  const k = document.getElementById('waKelas').value;
  api().withSuccessHandler((res) => {
    if (!res.success) { body.innerHTML = '<tr><td colspan="5" class="text-danger text-center">' + esc(res.error || 'Gagal memuat') + '</td></tr>'; return; }
    WA_LIST = res.daftar || [];
    renderPengingatWA();
  }).getDaftarPengingat(k === 'SEMUA' ? '' : k);
}

function renderPengingatWA() {
  const q = document.getElementById('waCari').value.trim().toLowerCase();
  const rows = WA_LIST.filter(s => !q || s.nama.toLowerCase().includes(q));
  document.getElementById('waBody').innerHTML = rows.length ? rows.map(s => {
    const rinci = [s.spp.length ? 'SPP ' + s.spp.length + ' bln' : '', s.kd.length ? 'KD ' + s.kd.length + ' pkn' : '', s.du.length ? 'Daftar Ulang' : ''].filter(Boolean).join(' · ');
    const aksi = s.hp
      ? `<a class="btn btn-success btn-sm py-0" target="_blank" rel="noopener" href="https://wa.me/${s.hp}?text=${encodeURIComponent(s.pesan)}"><i class="bi bi-whatsapp"></i> Kirim WA</a>`
      : '<span class="badge bg-secondary">No HP kosong/tidak valid</span>';
    return `<tr><td><b>${esc(s.nama)}</b></td><td>Kelas ${esc(s.kelas)}</td><td>${esc(s.wali || '-')}</td>
      <td><b class="text-danger">Rp ${Number(s.total).toLocaleString('id-ID')}</b><div class="small text-muted">${esc(rinci)}</div></td><td>${aksi}</td></tr>`;
  }).join('') : '<tr><td colspan="5" class="text-center text-muted py-3">Tidak ada santri dengan tunggakan.</td></tr>';
  labelTable(document.getElementById('waBody').closest('table'));
}

function showAlert(msg, isSuccess = true) {
  const alertBox = document.getElementById('alertBox');
  alertBox.className = `alert ${isSuccess ? 'alert-success' : 'alert-danger'} fw-bold`;
  alertBox.innerText = msg;
  alertBox.classList.remove('d-none');
  setTimeout(() => alertBox.classList.add('d-none'), 4000);
}

function downloadExcelSantri() {
  api().withSuccessHandler((res) => {
    if (!res.success) return showAlert(res.message || 'Gagal export data', false);

    let csvContent = "";
    res.data.forEach(rowArray => {
      let row = rowArray.map(item => { let v = String(item); if (/^[=+\-@]/.test(v) && isNaN(Number(v))) v = "'" + v; return `"${v.replace(/"/g, '""')}"`; }).join(",");
      csvContent += row + "\r\n";
    });

    const link = document.createElement("a");
    link.setAttribute("href", URL.createObjectURL(new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8' })));
    link.setAttribute("download", "Data_Santri_Darul_Amien.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }).exportDataSantri();
}

function handleImportCSV(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const text = e.target.result;
    const lines = text.split(/\r\n|\n/);
    const parsedData = lines.map(line => {
      return line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(cell => cell.replace(/^"|"$/g, '').trim());
    }).filter(r => r.length > 0 && r[0] !== '');

    if (parsedData.length === 0) {
      return showAlert('File CSV kosong atau format tidak valid.', false);
    }

    if (confirm(`Apakah Anda yakin ingin mengimpor ${parsedData.length} baris data santri?`)) {
      pendingAction = () => {
        const pass = document.getElementById('adminPasswordInput').value;
        api().withSuccessHandler((res) => {
          showAlert(res.message, res.success);
          if (res.success) initDashboard();
        }).importDataSantri(parsedData, pass);
      };
      document.getElementById('adminPasswordInput').value = '';
      passModalObj.show();
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

function triggerHapusSeluruhSantri() {
  if (!confirm("PERINGATAN HARD RESET!\n\nApakah Anda benar-benar ingin MENGHAPUS SELURUH DATA SANTRI?\nTindakan ini tidak dapat dibatalkan!")) {
    return;
  }

  pendingAction = () => {
    const pass = document.getElementById('adminPasswordInput').value;
    api().withSuccessHandler((res) => {
      showAlert(res.message, res.success);
      if (res.success) initDashboard();
    }).hapusSeluruhSantri(pass);
  };

  document.getElementById('adminPasswordInput').value = '';
  passModalObj.show();
}

// -----------------------------------------------------------------------------
// TAMPILAN HP (navigasi bawah, tabel->kartu, pencarian santri)
// -----------------------------------------------------------------------------
const SANTRI_CACHE = {};
const isMobile = () => window.matchMedia('(max-width: 767.98px)').matches;

function goView(v) {
  document.body.dataset.cur = v;
  document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('mv-hide', !el.dataset.view.split(' ').includes(v)));
  document.querySelectorAll('#bottomNav .bn-item').forEach(b => b.classList.toggle('active', b.dataset.go === v));
  if (v === 'santri') bootstrap.Tab.getOrCreateInstance(document.getElementById('tab-santri')).show();
  if (v === 'riwayat') {
    const aktif = document.querySelector('#myTab .nav-link.active');
    if (!aktif || aktif.id === 'tab-santri') bootstrap.Tab.getOrCreateInstance(document.getElementById('tab-spp')).show();
  }
  if (CK[v]) muatHalaman(v);
  window.scrollTo({ top: 0 });
}

function pilihBayar_lama(k) {
  document.querySelectorAll('[data-bayar]').forEach(el => el.classList.toggle('bayar-hide', el.dataset.bayar !== k));
  document.querySelectorAll('#segBayar [data-pilih]').forEach(b => b.classList.toggle('active', b.dataset.pilih === k));
}

function pilihBayar() {}
function mulaiBayar(k) { goView(k); }

function toggleFormSantri(show) {
  const c = document.getElementById('colFormSantri');
  const buka = (show === undefined) ? c.classList.contains('santri-form-closed') : !!show;
  c.classList.toggle('santri-form-closed', !buka);
  document.getElementById('btnTambahSantri').innerHTML = buka
    ? '<i class="bi bi-x-lg"></i> Tutup Form'
    : '<i class="bi bi-person-plus-fill"></i> Tambah Santri Baru';
}

// Dipakai tombol Edit: di HP pindah ke tab/form yang sesuai, di desktop cukup scroll ke atas
function irKeForm(k) {
  if (k === 'santri') { goView('santri'); toggleFormSantri(true); }
  else { goView(k); toggleManual(k, true); }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Menampilkan daftar santri pada dropdown + filter ketikan (nama / NIS)
function renderSantriOptions(selectId) {
  const sel = document.getElementById(selectId); if (!sel) return;
  const list = SANTRI_CACHE[selectId] || [];
  const cari = document.getElementById(selectId.replace('Santri', 'Cari'));
  const q = cari ? cari.value.trim().toLowerCase() : '';
  const prev = String(sel.value || '');
  const f = q ? list.filter(s => (String(s.nama) + ' ' + String(s.nis)).toLowerCase().includes(q)) : list;
  sel.innerHTML = '<option value="">-- Pilih Santri --</option>' + f.map(sn => `<option value="${esc(sn.nis)}">${esc(sn.nama)} (${esc(sn.nis)})${sn.kelas ? ' - Kls ' + esc(sn.kelas) : ''}</option>`).join('');
  if (q && f.length === 1) {                       // tinggal satu hasil -> langsung terpilih
    sel.value = f[0].nis;
    if (prev !== String(f[0].nis)) sel.dispatchEvent(new Event('change'));
  } else if (prev && f.some(s => String(s.nis) === prev)) {
    sel.value = prev;
  }
}

// Beri atribut data-label pada sel tabel agar bisa tampil sebagai kartu di HP
function labelTable(tbl) {
  if (!tbl) return;
  tbl.classList.add('stack');
  const labels = [...tbl.querySelectorAll('thead th')].map(th => th.textContent.trim());
  tbl.querySelectorAll('tbody tr').forEach(tr => {
    if (tr.children.length !== labels.length) return;
    [...tr.children].forEach((td, i) => td.setAttribute('data-label', labels[i]));
  });
}

// -----------------------------------------------------------------------------
// DETEKSI & PERBAIKAN NIS GANDA
// -----------------------------------------------------------------------------
let NIS_MAP = {};

function bukaNisGanda() {
  const b = document.getElementById('nisBody');
  b.innerHTML = '<div class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Memeriksa data santri...</div>';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('nisModal')).show();
  api().withSuccessHandler((res) => {
    if (!res || !res.success) { b.innerHTML = '<div class="alert alert-danger">' + esc((res && res.error) || 'Gagal memeriksa data.') + '</div>'; return; }
    renderNisGanda(res);
  }).getDaftarNisGanda();
}

function renderNisGanda(res) {
  NIS_MAP = {};
  const b = document.getElementById('nisBody');
  const baris = (s, k, boleh) => {
    NIS_MAP[k] = s;
    const st = s.status === 'Menunggak' ? 'bg-danger' : (s.status === 'Non-Aktif' ? 'bg-secondary' : 'bg-success');
    return `<div class="border rounded p-2 mb-2 bg-white">
      <div><b>${esc(s.nama)}</b> <span class="badge bg-secondary">Kelas ${esc(s.kelas)}</span> <span class="badge ${st}">${esc(s.status || 'Aktif')}</span></div>
      <div class="small text-muted">NIS: <code>${esc(s.nis)}</code> · baris ${s.row} · wali: ${esc(s.wali || '-')} · <b>${s.trx}</b> transaksi</div>
      <div class="input-group mt-2">
        ${boleh ? `<input type="text" id="nisBaru_${k}" class="form-control" placeholder="NIS baru" autocomplete="off">
        <button class="btn btn-primary" onclick="gantiNisGanda('${k}')">Ganti NIS</button>` : `<span class="form-control text-muted small d-flex align-items-center">Pilih salah satu untuk dihapus jika memang dobel</span>`}
        <button class="btn btn-outline-danger" title="Hapus data santri ini" onclick="hapusDobelNis('${k}')"><i class="bi bi-trash"></i></button>
      </div>
    </div>`;
  };

  let h = '';
  if (!res.ganda.length && !res.dobel.length) {
    h = `<div class="alert alert-success mb-0"><i class="bi bi-check-circle-fill"></i> Tidak ditemukan NIS ganda maupun santri dobel dari ${res.total} santri.</div>`;
  }

  if (res.ganda.length) {
    h += `<div class="alert alert-danger py-2 small mb-3"><b>${res.ganda.length} NIS dipakai lebih dari satu santri.</b> Ganti NIS salah satunya dengan NIS yang benar. Riwayat pembayaran hanya ikut pindah untuk santri yang NIS-nya diganti.</div>`;
    res.ganda.forEach((g, gi) => {
      h += `<div class="card card-custom mb-3 border-start border-4 border-danger"><div class="card-body p-2 p-md-3">
        <div class="fw-bold mb-1">NIS <code>${esc(g.nis)}</code> dipakai ${g.santri.length} santri
          ${g.jenis === 'MIRIP' ? '<span class="badge bg-warning text-dark">Mirip (beda nol di depan / spasi)</span>' : ''}</div>
        ${g.namaSama ? '<div class="small text-danger mb-2"><i class="bi bi-exclamation-triangle-fill"></i> Ada nama yang sama persis, kemungkinan satu santri terinput dua kali. Hapus data yang tanpa transaksi.</div>' : ''}
        ${g.santri.map((s, si) => baris(s, 'g' + gi + '_' + si, true)).join('')}
      </div></div>`;
    });
  }

  if (res.dobel.length) {
    h += `<div class="alert alert-warning py-2 small mb-3"><b>${res.dobel.length} santri bernama & sekelas sama tetapi NIS berbeda.</b> Bisa jadi satu orang terinput dua kali, bisa juga memang dua santri berbeda. Periksa sebelum menghapus.</div>`;
    res.dobel.forEach((g, gi) => {
      h += `<div class="card card-custom mb-3 border-start border-4 border-warning"><div class="card-body p-2 p-md-3">
        <div class="fw-bold mb-2">${esc(g.nama)} (Kelas ${esc(g.kelas)})</div>
        ${g.santri.map((s, si) => baris(s, 'd' + gi + '_' + si, false)).join('')}
      </div></div>`;
    });
  }
  b.innerHTML = h;
}

// Tutup modal NIS dulu, baru minta password (dua modal tidak boleh tumpang tindih)
function jalankanDariModalNis(fn, modalId) {
  pendingAction = fn;
  document.getElementById('adminPasswordInput').value = '';
  const el = document.getElementById(modalId || 'nisModal');
  el.addEventListener('hidden.bs.modal', () => passModalObj.show(), { once: true });
  bootstrap.Modal.getOrCreateInstance(el).hide();
}

function setelahPerbaikiNis(res) {
  showAlert(res.message, res.success);
  initDashboard();
  bukaNisGanda();          // periksa ulang & tampilkan sisa yang masih ganda
}

function gantiNisGanda(k) {
  const s = NIS_MAP[k]; if (!s) return;
  const nb = document.getElementById('nisBaru_' + k).value.trim();
  if (!nb) return showAlert('Isi NIS baru terlebih dahulu.', false);
  if (nb === s.nis) return showAlert('NIS baru sama dengan NIS lama.', false);
  const rf = s.row + '|' + s.nama;
  jalankanDariModalNis(() => {
    const pass = document.getElementById('adminPasswordInput').value;
    api().withSuccessHandler(setelahPerbaikiNis).ubahNisGanda({ rowId: rf, nisBaru: nb }, pass);
  });
}

function hapusDobelNis(k) {
  const s = NIS_MAP[k]; if (!s) return;
  const info = s.trx ? `\n\nSantri ini punya ${s.trx} transaksi. Riwayat TIDAK ikut dihapus dan tetap tercatat atas nama & NIS ini.` : '';
  if (!confirm(`Hapus data santri "${s.nama}" (NIS ${s.nis}, baris ${s.row})?` + info)) return;
  const rf = s.row + '|' + s.nama;
  jalankanDariModalNis(() => {
    const pass = document.getElementById('adminPasswordInput').value;
    api().withSuccessHandler(setelahPerbaikiNis).hapusData('DataSantri', rf, pass);
  });
}

// -----------------------------------------------------------------------------
// TRANSAKSI TANPA NIS (dikelompokkan per nama)
// -----------------------------------------------------------------------------
let TRX_LIST = [];

function bukaTrxTanpaNis() {
  const b = document.getElementById('trxBody');
  b.innerHTML = '<div class="text-center text-muted py-4"><span class="spinner-border spinner-border-sm me-2"></span>Memeriksa transaksi...</div>';
  bootstrap.Modal.getOrCreateInstance(document.getElementById('trxModal')).show();
  api().withSuccessHandler((res) => {
    if (!res || !res.success) { b.innerHTML = '<div class="alert alert-danger">' + esc((res && res.error) || 'Gagal memuat.') + '</div>'; return; }
    TRX_LIST = res.daftar || [];
    if (!TRX_LIST.length) { b.innerHTML = '<div class="alert alert-success mb-0"><i class="bi bi-check-circle-fill"></i> Semua transaksi sudah terhubung ke NIS.</div>'; return; }
    b.innerHTML = `<div class="alert alert-info py-2 small">${TRX_LIST.length} nama belum terhubung. Pilih santri yang benar untuk tiap nama, lalu tekan tombol di bawah. Semua transaksi bernama itu ikut terhubung. Yang dikosongkan dilewati.</div>` +
      TRX_LIST.map((x, i) => {
        const opts = x.kandidat.length ? x.kandidat : x.mirip;
        const badge = x.kandidat.length > 1 ? `<span class="badge bg-warning text-dark">Nama ganda (${x.kandidat.length} santri)</span>`
          : x.kandidat.length === 1 ? '<span class="badge bg-success">Cocok 1 santri</span>'
          : opts.length ? '<span class="badge bg-info text-dark">Nama mirip</span>' : '<span class="badge bg-danger">Tidak ditemukan</span>';
        const rinci = [x.spp ? 'SPP ' + x.spp : '', x.kd ? 'KD ' + x.kd : '', x.du ? 'DU ' + x.du : ''].filter(Boolean).join(' · ');
        const pilih = opts.length
          ? `<select id="trxNis_${i}" class="form-select"><option value="">-- Pilih santri --</option>${opts.map(sn => `<option value="${esc(sn.nis)}"${x.kandidat.length === 1 ? ' selected' : ''}>${esc(sn.nama)} · Kelas ${esc(sn.kelas)} · NIS ${esc(sn.nis)}</option>`).join('')}</select>`
          : `<input type="text" id="trxNis_${i}" class="form-control" placeholder="Ketik NIS santri (opsional)" autocomplete="off">`;
        return `<div class="border rounded p-2 mb-2"><div class="d-flex justify-content-between align-items-start gap-2"><b>${esc(x.nama)}</b>${badge}</div>
          <div class="small text-muted mb-2">${rinci} transaksi</div>${pilih}</div>`;
      }).join('');
  }).getTransaksiTanpaNis();
}

function simpanTrxNis() {
  const pilihan = [];
  TRX_LIST.forEach((x, i) => { const el = document.getElementById('trxNis_' + i); if (el && el.value.trim()) pilihan.push({ nama: x.nama, nis: el.value.trim() }); });
  if (!pilihan.length) return showAlert('Belum ada santri yang dipilih.', false);
  jalankanDariModalNis(() => {
    const pass = document.getElementById('adminPasswordInput').value;
    api().withSuccessHandler((res) => { showAlert(res.message, res.success); initDashboard(); bukaTrxTanpaNis(); }).hubungkanTrxBanyak(pilihan, pass);
  }, 'trxModal');
}

document.getElementById('passModal').addEventListener('shown.bs.modal', () => document.getElementById('adminPasswordInput').focus());
if (isMobile()) document.getElementById('boxFilterTunggakan').classList.add('d-none');


// -----------------------------------------------------------------------------
// HALAMAN PEMBAYARAN DENGAN DAFTAR CENTANG (SPP / Kost Dapur / Daftar Ulang)
// -----------------------------------------------------------------------------
const BULAN = ['Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni'];
const HAL = {
  spp: { jenis: 'SPP', judul: 'SPP Bulanan', ico: 'credit-card-fill' },
  kd:  { jenis: 'KD',  judul: 'Kost Dapur', ico: 'cup-hot-fill' },
  du:  { jenis: 'DU',  judul: 'Daftar Ulang', ico: 'mortarboard-fill' }
};
const CK = {};
const rpf = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
const v_ = id => document.getElementById(id).value;
const bulanIni_ = () => ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'][new Date().getMonth()];
const tahunAjaran_ = () => { const d = new Date(), y = d.getFullYear(); return d.getMonth() >= 6 ? y + '/' + (y + 1) : (y - 1) + '/' + y; };

function labelHal_(k) {
  if (k === 'spp') return v_('ck-spp-bulan');
  if (k === 'kd') return v_('ck-kd-bulan') + ' - ' + v_('ck-kd-pekan');
  return v_('ck-du-periode').trim();
}

function buatHalaman(k) {
  const h = HAL[k], opsiBulan = BULAN.map(b => `<option${b === bulanIni_() ? ' selected' : ''}>${b}</option>`).join('');
  let kontrol = '';
  if (k === 'spp') kontrol = `<div class="col-12"><select id="ck-spp-bulan" class="form-select">${opsiBulan}</select></div>`;
  if (k === 'kd') kontrol = `<div class="col-7"><select id="ck-kd-bulan" class="form-select">${opsiBulan}</select></div>
    <div class="col-5"><select id="ck-kd-pekan" class="form-select">${[1, 2, 3, 4, 5].map(p => `<option${p === Math.min(5, Math.ceil(new Date().getDate() / 7)) ? ' selected' : ''}>Pekan ${p}</option>`).join('')}</select></div>`;
  if (k === 'du') kontrol = `<div class="col-12"><input id="ck-du-periode" class="form-control" value="${tahunAjaran_()}" placeholder="Tahun ajaran, mis. 2026/2027"></div>`;
  CK[k] = { items: [], sel: new Set(), kelas: '', cari: '', lunas: false, label: '' };
  const el = document.getElementById('pg-' + k);
  el.innerHTML = `
    <div class="card card-custom p-3 bg-white mb-3">
      <div class="d-flex justify-content-between align-items-center mb-2">
        <h6 class="fw-bold mb-0"><i class="bi bi-${h.ico}"></i> ${h.judul}</h6>
        <button type="button" class="btn btn-outline-secondary btn-sm" onclick="toggleManual('${k}')">Input manual</button>
      </div>
      <div class="row g-2 mb-2">${kontrol}</div>
      <div id="sum-${k}"></div>
      <div id="chips-${k}" class="chips"></div>
      <input type="search" class="form-control ck-cari mb-1" placeholder="Cari nama / NIS..." autocomplete="off">
      <div class="form-check form-switch my-2"><input class="form-check-input ck-showlunas" type="checkbox" id="swl-${k}"><label class="form-check-label small" for="swl-${k}">Tampilkan yang sudah lunas</label></div>
      <div id="list-${k}"></div>
    </div>
    <div id="bar-${k}" class="aksi-bar d-none"><div><div class="fw-bold" id="barN-${k}"></div><div class="small text-muted" id="barT-${k}"></div></div>
      <button class="btn btn-success fw-bold px-4" id="btnSimpan-${k}" onclick="simpanCentang('${k}')"><i class="bi bi-check2-all"></i> Tandai Lunas</button></div>`;
  el.querySelectorAll('select, #ck-du-periode').forEach(x => x.addEventListener('change', () => muatHalaman(k)));
  el.addEventListener('click', e => {
    const st = CK[k], c = e.target.closest('.chip');
    if (c) { st.kelas = c.dataset.kelas; renderHalaman(k); return; }
    const row = e.target.closest('.ck-row');
    if (row && row.dataset.ref && e.target.tagName !== 'INPUT' && !row.classList.contains('lns')) { e.preventDefault(); toggleCentang_(k, row.dataset.ref); }
  });
  el.addEventListener('change', e => {
    const st = CK[k];
    if (e.target.classList.contains('ck-item')) toggleCentang_(k, e.target.closest('.ck-row').dataset.ref);
    if (e.target.classList.contains('ck-showlunas')) { st.lunas = e.target.checked; renderHalaman(k); }
    if (e.target.classList.contains('ck-all')) {
      tampil_(k).filter(i => !i.lunas).forEach(i => e.target.checked ? st.sel.add(i.ref) : st.sel.delete(i.ref));
      renderHalaman(k);
    }
  });
  el.addEventListener('input', e => { if (e.target.classList.contains('ck-cari')) { CK[k].cari = e.target.value; renderHalaman(k); } });
}

function toggleCentang_(k, ref) {
  const s = CK[k].sel; s.has(ref) ? s.delete(ref) : s.add(ref);
  renderHalaman(k);
}

function tampil_(k) {
  const st = CK[k], q = st.cari.trim().toLowerCase();
  return st.items.filter(i => (!st.kelas || (i.kelas || '-') === st.kelas) && (!q || (i.nama + ' ' + i.nis).toLowerCase().includes(q)) && (st.lunas || !i.lunas));
}

function muatHalaman(k) {
  const st = CK[k], label = labelHal_(k);
  st.sel.clear(); st.kelas = ''; st.label = label;
  if (!label) { st.items = []; return renderHalaman(k); }
  document.getElementById('list-' + k).innerHTML = '<div class="text-center text-muted py-4">Memuat...</div>';
  api().withSuccessHandler(res => {
    if (labelHal_(k) !== label) return;
    if (!res.success) showAlert(res.message, false);
    st.items = res.success ? res.items : [];
    renderHalaman(k);
  }).getTagihanPeriode(HAL[k].jenis, label);
}

function renderHalaman(k) {
  const st = CK[k], all = st.items, lns = all.filter(i => i.lunas);
  const total = all.reduce((s, i) => s + i.nominal, 0), ter = lns.reduce((s, i) => s + i.nominal, 0);
  const aktif = new Set(all.map(i => i.ref)); st.sel.forEach(r => { if (!aktif.has(r)) st.sel.delete(r); });
  document.getElementById('sum-' + k).innerHTML = all.length
    ? `<div class="d-flex justify-content-between small mb-1"><span><b>${lns.length}</b> dari ${all.length} santri lunas</span><span>${rpf(ter)} / ${rpf(total)}</span></div><div class="progress mb-2" style="height:8px"><div class="progress-bar bg-success" style="width:${total ? Math.round(ter / total * 100) : 0}%"></div></div>` : '';
  const kls = [...new Set(all.map(i => i.kelas || '-'))];
  document.getElementById('chips-' + k).innerHTML = all.length ? ['', ...kls].map(c => {
    const belum = all.filter(i => (!c || (i.kelas || '-') === c) && !i.lunas).length;
    return `<button type="button" class="chip${st.kelas === c ? ' on' : ''}" data-kelas="${esc(c)}">${c ? 'Kls ' + esc(c) : 'Semua'} <span>${belum || '✓'}</span></button>`;
  }).join('') : '';
  const rows = tampil_(k), belumTampil = rows.filter(i => !i.lunas);
  let html = '';
  if (!all.length) html = `<div class="text-center text-muted py-4">Belum ada tagihan untuk periode ini.<br><span class="small">Buat dulu lewat kartu "Buat Tagihan Masal" di bawah.</span></div>`;
  else if (!rows.length) html = `<div class="text-center text-muted py-4">${all.some(i => !i.lunas) ? 'Tidak ada yang cocok.' : '🎉 Semua sudah lunas.'}</div>`;
  else {
    if (belumTampil.length) html += `<label class="ck-row" style="background:#f8f9fa"><input type="checkbox" class="form-check-input ck-all" ${belumTampil.every(i => st.sel.has(i.ref)) ? 'checked' : ''}><div class="ck-main fw-semibold">Pilih semua yang tampil (${belumTampil.length})</div></label>`;
    html += rows.map(i => `<label class="ck-row${st.sel.has(i.ref) ? ' sel' : ''}${i.lunas ? ' lns' : ''}" data-ref="${esc(i.ref)}"><input type="checkbox" class="form-check-input ck-item" ${i.lunas ? 'checked disabled' : (st.sel.has(i.ref) ? 'checked' : '')}><div class="ck-main"><div class="ck-nama">${esc(i.nama)}</div><div class="ck-sub">${esc(i.nis)}${i.kelas ? ' · Kls ' + esc(i.kelas) : ''}${i.lunas ? ' · Lunas' : ''}</div></div><div class="ck-nom">${rpf(i.nominal)}</div></label>`).join('');
  }
  document.getElementById('list-' + k).innerHTML = html;
  const pilih = all.filter(i => st.sel.has(i.ref));
  document.getElementById('bar-' + k).classList.toggle('d-none', !pilih.length);
  document.getElementById('barN-' + k).textContent = pilih.length + ' santri dipilih';
  document.getElementById('barT-' + k).textContent = rpf(pilih.reduce((s, i) => s + i.nominal, 0));
}

function simpanCentang(k) {
  const st = CK[k], pilih = st.items.filter(i => st.sel.has(i.ref));
  if (!pilih.length) return;
  const total = pilih.reduce((s, i) => s + i.nominal, 0);
  if (!confirm(`Tandai LUNAS ${pilih.length} santri\n${HAL[k].judul} - ${st.label}\nTotal ${rpf(total)}\n\nLanjutkan?`)) return;
  const btn = document.getElementById('btnSimpan-' + k); btn.disabled = true;
  api().withSuccessHandler(res => {
    btn.disabled = false;
    showAlert(res.message, res.success);
    if (res.success) tampilUndo_(res.message);
    segarkanSetelahBayar_();
  }).withFailureHandler(err => { btn.disabled = false; showAlert('Error: ' + err.message, false); })
    .tandaiLunasBanyak(HAL[k].jenis, pilih.map(i => i.ref));
}

let undoTimer;
function tampilUndo_(msg) {
  const b = document.getElementById('undoBar');
  document.getElementById('undoTeks').textContent = msg;
  b.classList.remove('d-none');
  clearTimeout(undoTimer); undoTimer = setTimeout(() => b.classList.add('d-none'), 300000);
}

function batalkanTerakhir() {
  if (!confirm('Batalkan penandaan lunas yang terakhir?')) return;
  api().withSuccessHandler(res => {
    showAlert(res.message, res.success);
    document.getElementById('undoBar').classList.add('d-none');
    segarkanSetelahBayar_();
  }).batalkanLunasTerakhir();
}

function segarkanSetelahBayar_() {
  loadKasSummary(); loadDashboard(); loadJumlahSantri(); loadChartPersentase(); loadTunggakan();
  const cur = document.body.dataset.cur;
  if (CK[cur]) muatHalaman(cur);
}

function toggleManual(k, buka) {
  const el = document.querySelector('[data-manual="' + k + '"]');
  if (el) el.classList.toggle('manual-closed', buka === undefined ? !el.classList.contains('manual-closed') : !buka);
}

// Inisialisasi (harus di paling bawah, setelah semua konstanta dibuat)
['spp', 'kd', 'du'].forEach(buatHalaman);
goView('home');
