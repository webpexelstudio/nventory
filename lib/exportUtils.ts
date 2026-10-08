import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// 1. Export to Excel Sheet (.xlsx)
export const exportToExcel = (data: any[], fileName: string) => {
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'DataReport');
  XLSX.writeFile(workbook, `${fileName}_${new Date().toISOString().split('T')[0]}.xlsx`);
};

// 2. Export to PDF (.pdf)
export const exportToPDF = (headers: string[], rows: any[][], title: string) => {
  const doc = new jsPDF();
  doc.text(title, 14, 15);
  autoTable(doc, {
    startY: 20,
    head: [headers],
    body: rows,
    theme: 'grid',
    headStyles: { fillColor: [79, 70, 229] }, // Indigo header
  });
  doc.save(`${title.toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`);
};