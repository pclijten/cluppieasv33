/* ==================== TRAININGSGEBRUIK: DELEN ALS EXCEL OF PDF ====================
   Lazy geladen vanuit club-trainingsgebruik.js zodra de admin op Excel/PDF tikt.
   Krijgt een plat export-model (zie exportModel daar) en maakt er een bestand van,
   dat via de deel-sheet (mobiel) of als download (desktop) wordt aangeboden.

   AVG: alleen teamniveau (teamnamen, datums, tijden, aantallen). Geen spelers-
   of coachnamen; daarmee valt dit buiten de regel "geen spelersdata in losse
   exportbestanden".

   Libraries pas bij gebruik: ExcelJS (zelfde versie als de andere exports) en
   jsPDF + jspdf-autotable. */

const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
const AUTOTABLE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';

// celkleuren (licht, goed leesbaar op papier en in Excel)
const KLEUR = { vol:'C9EBD7', deel:'FBE3B5', nul:'F8CFCD', geen:'EEF1F4' };
const ACCENT = 'C8211C';

const _laden = new Map();
function laadScript(url, klaar){
  if (klaar()) return Promise.resolve();
  if (_laden.has(url)) return _laden.get(url);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = url;
    s.onload = resolve;
    s.onerror = () => { _laden.delete(url); reject(new Error('Kon de export-library niet laden: controleer je internetverbinding')); };
    document.head.appendChild(s);
  });
  _laden.set(url, p);
  return p;
}

function bestandsnaam(m, ext){
  const w = m.weken.length ? (m.weken.length === 1 ? `wk ${m.weken[0]}` : `wk ${m.weken[0]}-${m.weken[m.weken.length - 1]}`) : '';
  const basis = `Trainingsgebruik ${m.club} ${m.bouw === 'Alle teams' ? '' : m.bouw + ' '}${w}`.trim();
  return basis.replace(/[\\/:*?"<>|']+/g, '').replace(/\s+/g, ' ') + '.' + ext;
}
const datumTekst = d => d.toLocaleDateString('nl-NL', { day:'numeric', month:'long', year:'numeric' });

/* deel-sheet op mobiel (WhatsApp, mail, …), anders downloaden */
async function deel(blob, naam, titel){
  if (navigator.canShare){
    try {
      const file = new File([blob], naam, { type: blob.type });
      if (navigator.canShare({ files: [file] })){
        await navigator.share({ files: [file], title: titel });
        return;
      }
    } catch (e){
      if (e && e.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = naam;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const celTekst = c => c.gep ? `${c.vl}/${c.gep}` : '-';
const pctTekst = p => p == null ? '-' : `${p}%`;

/* ==================== EXCEL ==================== */
export async function exportExcel(m){
  await laadScript(EXCELJS_URL, () => !!window.ExcelJS);
  const wb = new window.ExcelJS.Workbook();
  wb.creator = 'Cluppie'; wb.created = new Date();
  const vet = { bold: true };
  const vul = hex => ({ type:'pattern', pattern:'solid', fgColor:{ argb:'FF' + hex } });

  /* Samenvatting */
  const ws0 = wb.addWorksheet('Samenvatting');
  ws0.columns = [{ width: 42 }, { width: 22 }];
  ws0.addRow([`Trainingsgebruik ${m.club}`]).font = { bold:true, size:14 };
  ws0.addRow([`${m.bouw} · ${m.periode}`]);
  ws0.addRow([`Gemaakt op ${datumTekst(m.gemaakt)}`]);
  ws0.addRow([]);
  [['Trainingen met presentie', m.kpi.presentie],
   ['Oefenstof vooraf of op de dag geopend', m.kpi.oefenstof],
   ['Presentie op de trainingsdag zelf', m.kpi.dagZelf]].forEach(r => { const row = ws0.addRow(r); row.getCell(1).font = vet; });
  ws0.addRow([]);
  ws0.addRow(['Alleen teamniveau, zonder namen. Afgelaste dagen tellen niet mee.']).font = { italic:true, color:{ argb:'FF5A6572' } };

  /* Rooster per week (presentie en oefenstof) */
  const rooster = (naam, rijen) => {
    const ws = wb.addWorksheet(naam);
    ws.columns = [{ header:'Team', key:'team', width:16 },
      ...m.weken.map((nr, i) => ({ header:`wk ${nr}`, key:'w' + i, width:9 })),
      { header:'%', key:'pct', width:8 }];
    ws.getRow(1).font = vet;
    ws.views = [{ state:'frozen', xSplit:1, ySplit:1 }];
    for (const r of rijen){
      const rij = { team: r.team, pct: r.pct == null ? null : r.pct / 100 };
      r.cellen.forEach((c, i) => { rij['w' + i] = celTekst(c); });
      const row = ws.addRow(rij);
      r.cellen.forEach((c, i) => {
        const cel = row.getCell('w' + i);
        cel.fill = vul(KLEUR[c.klasse]);
        cel.alignment = { horizontal:'center' };
      });
      row.getCell('pct').numFmt = '0%';
      row.getCell('team').font = vet;
    }
  };
  rooster('Presentie per week', m.presentie);
  rooster('Oefenstof per week', m.oefenstof);

  /* Moment van openen / invullen per team */
  const wsV = wb.addWorksheet('Moment per team');
  wsV.columns = [
    { header:'Team', key:'team', width:16 },
    { header:'Oefenstof 2+ dagen vooruit', key:'o3', width:14 }, { header:'Oefenstof dag ervoor', key:'o1', width:14 },
    { header:'Oefenstof dag zelf', key:'o0', width:14 }, { header:'Oefenstof pas erna of niet', key:'ox', width:14 },
    { header:'Presentie tijdens training', key:'pt', width:14 }, { header:'Presentie zelfde dag erna', key:'pz', width:14 },
    { header:'Presentie later nagetypt', key:'pn', width:14 }, { header:'Presentie niet ingevuld', key:'px', width:14 },
  ];
  wsV.getRow(1).font = vet;
  wsV.getRow(1).alignment = { wrapText:true, vertical:'top' };
  const frac = v => v == null ? null : v / 100;
  for (const v of m.verdeling){
    const row = wsV.addRow({ team:v.team,
      o3:frac(v.open['3']), o1:frac(v.open['1']), o0:frac(v.open['0']), ox:frac(v.open.x),
      pt:frac(v.pres.t), pz:frac(v.pres.z), pn:frac(v.pres.n), px:frac(v.pres.x) });
    row.eachCell((c, i) => { if (i > 1) c.numFmt = '0%'; });
  }

  /* Alle trainingen, één rij per training */
  const wsT = wb.addWorksheet('Per training');
  wsT.columns = [
    { header:'Team', key:'team', width:14 }, { header:'Week', key:'week', width:7 },
    { header:'Datum', key:'datum', width:12 }, { header:'Dag', key:'dag', width:14 },
    { header:'Trainingstijd', key:'tijd', width:13 }, { header:'Extra training', key:'extra', width:9 },
    { header:'Afgelast', key:'afgelast', width:9 }, { header:'Oefenstof', key:'oefenstof', width:32 },
    { header:'Eerst geopend op', key:'geopendOp', width:17 }, { header:'Keer geopend', key:'keerGeopend', width:9 },
    { header:'Moment openen', key:'openMoment', width:18 }, { header:'Presentie', key:'presentie', width:10 },
    { header:'Presentie op', key:'presentieOp', width:17 }, { header:'Moment presentie', key:'presentieMoment', width:18 },
  ];
  wsT.getRow(1).font = vet;
  wsT.views = [{ state:'frozen', ySplit:1 }];
  wsT.autoFilter = { from:'A1', to:'N1' };
  m.trainingen.forEach(t => wsT.addRow(t));

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  await deel(blob, bestandsnaam(m, 'xlsx'), 'Trainingsgebruik');
}

/* ==================== PDF ==================== */
const rgb = hex => [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
// jsPDF-standaardfonts kennen alleen Latin-1: vervang tekens daarbuiten
const pdfTekst = s => String(s ?? '').replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^\x00-\xFF]/g, '');

export async function exportPdf(m){
  await laadScript(JSPDF_URL, () => !!window.jspdf?.jsPDF);
  await laadScript(AUTOTABLE_URL, () => !!window.jspdf?.jsPDF?.API?.autoTable);
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ orientation:'landscape', unit:'mm', format:'a4' });
  const marge = 14;
  const breed = pdf.internal.pageSize.getWidth();

  // kop
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.setTextColor(...rgb('1A1F26'));
  pdf.text(pdfTekst(`Trainingsgebruik ${m.club}`), marge, 18);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...rgb('5A6572'));
  pdf.text(pdfTekst(`${m.bouw} · ${m.periode} · gemaakt op ${datumTekst(m.gemaakt)}`), marge, 24);

  // kerncijfers
  const kpis = [[m.kpi.presentie, 'trainingen met presentie'], [m.kpi.oefenstof, 'oefenstof vooraf of op de dag geopend'], [m.kpi.dagZelf, 'presentie op de trainingsdag zelf']];
  const kw = (breed - 2 * marge - 2 * 6) / 3;
  kpis.forEach(([g, l], i) => {
    const x = marge + i * (kw + 6);
    pdf.setDrawColor(...rgb('D9DEE4')); pdf.roundedRect(x, 29, kw, 18, 2, 2);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.setTextColor(...rgb(ACCENT));
    pdf.text(pdfTekst(g), x + 5, 39);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(...rgb('5A6572'));
    pdf.text(pdfTekst(l), x + 5, 44);
  });

  const kop = ['Team', ...m.weken.map(nr => `wk ${nr}`), '%'];
  const roosterTabel = (titel, rijen, startY) => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(...rgb('1A1F26'));
    pdf.text(pdfTekst(titel), marge, startY);
    pdf.autoTable({
      startY: startY + 3, margin:{ left:marge, right:marge },
      head:[kop.map(pdfTekst)],
      body: rijen.map(r => [r.team, ...r.cellen.map(celTekst), pctTekst(r.pct)].map(pdfTekst)),
      theme:'grid',
      styles:{ fontSize: m.weken.length > 14 ? 7 : 9, halign:'center', cellPadding:1.6, lineColor:[255,255,255], lineWidth:0.6 },
      headStyles:{ fillColor:rgb('1F262F'), textColor:255, fontStyle:'bold' },
      columnStyles:{ 0:{ halign:'left', fontStyle:'bold', cellWidth:28 } },
      didParseCell: d => {
        if (d.section !== 'body') return;
        const r = rijen[d.row.index];
        const i = d.column.index - 1;
        if (i >= 0 && i < r.cellen.length) d.cell.styles.fillColor = rgb(KLEUR[r.cellen[i].klasse]);
      },
    });
    return pdf.lastAutoTable.finalY;
  };
  let y = roosterTabel('Presentie ingevuld per week', m.presentie, 56);
  y = roosterTabel('Oefenstof geopend per week', m.oefenstof, y + 10);

  // moment per team
  pdf.addPage();
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(12); pdf.setTextColor(...rgb('1A1F26'));
  pdf.text('Moment van openen en invullen per team', marge, 18);
  pdf.autoTable({
    startY: 21, margin:{ left:marge, right:marge },
    head:[
      [{ content:'', styles:{ fillColor:[255,255,255] } }, { content:'Oefenstof geopend', colSpan:4 }, { content:'Presentie ingevuld', colSpan:4 }],
      ['Team', '2+ dagen vooruit', 'dag ervoor', 'dag zelf', 'pas erna of niet', 'tijdens training', 'zelfde dag erna', 'later nagetypt', 'niet ingevuld'],
    ],
    body: m.verdeling.map(v => [v.team, pctTekst(v.open['3']), pctTekst(v.open['1']), pctTekst(v.open['0']), pctTekst(v.open.x),
      pctTekst(v.pres.t), pctTekst(v.pres.z), pctTekst(v.pres.n), pctTekst(v.pres.x)].map(pdfTekst)),
    theme:'striped',
    styles:{ fontSize:9, halign:'center', cellPadding:1.8 },
    headStyles:{ fillColor:rgb('1F262F'), textColor:255, fontStyle:'bold' },
    columnStyles:{ 0:{ halign:'left', fontStyle:'bold', cellWidth:28 } },
  });

  // voetregel op elke pagina
  const n = pdf.getNumberOfPages();
  for (let i = 1; i <= n; i++){
    pdf.setPage(i);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...rgb('8B95A1'));
    pdf.text(pdfTekst('Cluppie · alleen teamniveau, zonder namen · afgelaste dagen tellen niet mee'), marge, pdf.internal.pageSize.getHeight() - 8);
    pdf.text(`${i}/${n}`, breed - marge, pdf.internal.pageSize.getHeight() - 8, { align:'right' });
  }

  const blob = pdf.output('blob');
  await deel(blob, bestandsnaam(m, 'pdf'), 'Trainingsgebruik');
}
