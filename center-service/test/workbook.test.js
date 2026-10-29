import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildCenterWorkbook } from '../../shared/center-workbook.mjs';
test('workbook worker preserves identifiers and treats untrusted formulas as text',async()=>{
  const buffer=await buildCenterWorkbook(import.meta.resolve('exceljs/dist/exceljs.min.js'),{
    rows:[{Codigo:'001',Valor:'=HYPERLINK("external")',Objeto:{formula:'1+1'}}],sheetName:'Datos',widths:[20,30,30]});
  const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(buffer);const sheet=workbook.worksheets[0];
  assert.equal(sheet.getCell('A2').value,'001');assert.equal(sheet.getCell('B2').type,ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('C2').type,ExcelJS.ValueType.String);assert.equal(sheet.getColumn(1).width,20);
});
