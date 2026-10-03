// Apps Script del libro de Google Sheets "Control de Entregas"
// Extensiones > Apps Script > pega este código > Implementar > Aplicación web
// Ejecutar como: Yo · Quién tiene acceso: Cualquier persona
var TOKEN = 'CAMBIA-ESTE-TOKEN';
var HOJA  = 'Entregas';
var COLS = ['id','fecha','turno','nombre','op','sap','descripcion','cliente','pedido','empaque','u','c','total','estado','creado'];
var HEAD = ['ID','Fecha','Turno','Habilitador','OP','SAP','Descripción','Cliente','Cantidad pedida','Empaque (entrega)','Unid x empaque','Cant. empaques','Total entregado','Estado','Creado'];

function hoja_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Crea el script desde el libro: Extensiones > Apps Script');
  var sh = ss.getSheetByName(HOJA);
  if (!sh) {
    sh = ss.insertSheet(HOJA);
    sh.getRange('A:B').setNumberFormat('@');
    sh.getRange('F:F').setNumberFormat('@');
    sh.appendRow(HEAD);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, HEAD.length).setFontWeight('bold').setBackground('#F2A93B');
  }
  return sh;
}
function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function doGet() { return out_({ ok: true, msg: 'Control de Entregas activo' }); }

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var p = JSON.parse(e.postData.contents);
    if (p.token !== TOKEN) return out_({ ok: false, error: 'Token incorrecto' });
    lock.waitLock(20000);
    var sh = hoja_();
    var n = sh.getLastRow() - 1;
    var ids = n > 0 ? sh.getRange(2, 1, n, 1).getValues().map(function (r) { return String(r[0]); }) : [];

    if (p.action === 'upsert') {
      p.records.forEach(function (r) {
        var fila = COLS.map(function (c) { return r[c] === undefined ? '' : r[c]; });
        var i = ids.indexOf(String(r.id));
        if (i >= 0) sh.getRange(i + 2, 1, 1, COLS.length).setValues([fila]);
        else { sh.appendRow(fila); ids.push(String(r.id)); }
      });
      return out_({ ok: true });
    }
    if (p.action === 'delete') {
      var j = ids.indexOf(String(p.id));
      if (j >= 0) sh.deleteRow(j + 2);
      return out_({ ok: true });
    }
    if (p.action === 'list') {
      var tz = Session.getScriptTimeZone();
      var vals = n > 0 ? sh.getRange(2, 1, n, COLS.length).getValues() : [];
      var recs = vals.map(function (row) {
        var o = {};
        COLS.forEach(function (c, k) {
          var v = row[k];
          if (v instanceof Date) v = Utilities.formatDate(v, tz, c === 'fecha' ? 'yyyy-MM-dd' : "yyyy-MM-dd'T'HH:mm:ss");
          o[c] = v;
        });
        return o;
      });
      return out_({ ok: true, records: recs });
    }
    return out_({ ok: false, error: 'Acción desconocida' });
  } catch (err) {
    return out_({ ok: false, error: String(err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}
