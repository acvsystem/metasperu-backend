import { parentPort,workerData } from 'node:worker_threads';
try {
  const imported=await import(workerData.libraryUrl),ExcelJS=imported.default||imported;
  const {rows,sheetName,headers:providedHeaders,widths=[]}=workerData.options;
  if(!Array.isArray(rows)||rows.length>100000)throw new Error('Report limit');
  const headers=providedHeaders||[...new Set(rows.flatMap(row=>Object.keys(row)))];
  if(!headers.length||headers.length>200)throw new Error('Column limit');
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet(String(sheetName||'Reporte').replace(/[\/*?:\[\]]/g,' ').slice(0,31));
  sheet.addRow(headers);sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};
  sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF193F72'}};
  for(const row of rows)sheet.addRow(headers.map(key=>{
    const value=Object.prototype.hasOwnProperty.call(row,key)?row[key]:null;
    if(value===null||value===undefined)return '';
    if(value instanceof Date||typeof value==='boolean')return value;
    if(typeof value==='number')return Number.isFinite(value)?value:'';
    const text=typeof value==='object'?JSON.stringify(value):String(value);
    if(text.length>32767)throw new Error('Cell limit');return text;
  }));
  widths.forEach((width,index)=>sheet.getColumn(index+1).width=Math.min(80,Math.max(5,width)));
  sheet.views=[{state:'frozen',ySplit:1}];
  const buffer=new Uint8Array(await workbook.xlsx.writeBuffer()).buffer;
  parentPort.postMessage({ok:true,buffer},[buffer]);
}catch{parentPort.postMessage({ok:false});}
