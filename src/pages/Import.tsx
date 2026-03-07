import React, { useState } from 'react';
import Papa from 'papaparse';
import { Upload, FileSpreadsheet, Check } from 'lucide-react';

export default function Import() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [uploading, setUploading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      
      Papa.parse(selectedFile, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          setPreview(results.data.slice(0, 5)); // Preview first 5 rows
        },
      });
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const items = results.data.map((row: any) => ({
          description: row['Item Description'] || row['description'] || '',
          quantity: parseInt(row['Quantity'] || row['quantity'] || '0'),
          upc: row['UPC'] || row['upc'] || '',
          number: row['Number'] || row['number'] || '',
          tag_names: row['Tag Names'] || row['tag_names'] || '',
        })).filter((item: any) => item.upc); // Ensure UPC exists

        try {
          const res = await fetch('/api/inventory/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items }),
          });

          if (res.ok) {
            const data = await res.json();
            alert(`Import successful! Added: ${data.added}, Updated: ${data.updated}`);
            setFile(null);
            setPreview([]);
          } else {
            alert('Import failed.');
          }
        } catch (err) {
          console.error(err);
          alert('Error uploading file.');
        } finally {
          setUploading(false);
        }
      },
    });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-navy-900">Import Wizard</h2>
        <p className="text-slate-500">Upload CSV/Excel files to bulk update inventory</p>
      </div>

      <div className="bg-white p-8 rounded-2xl shadow-sm border border-slate-200 text-center">
        <div className="max-w-xl mx-auto">
          <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-slate-300 border-dashed rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <Upload className="w-12 h-12 text-slate-400 mb-4" />
              <p className="mb-2 text-sm text-slate-500">
                <span className="font-semibold">Click to upload</span> or drag and drop
              </p>
              <p className="text-xs text-slate-500">CSV files only (Max 10MB)</p>
            </div>
            <input type="file" className="hidden" accept=".csv" onChange={handleFileChange} />
          </label>
        </div>

        {file && (
          <div className="mt-6 max-w-xl mx-auto text-left">
            <div className="flex items-center gap-3 p-4 bg-emerald-50 text-emerald-700 rounded-lg mb-4">
              <FileSpreadsheet size={20} />
              <span className="font-medium">{file.name}</span>
              <span className="text-xs opacity-75">({(file.size / 1024).toFixed(1)} KB)</span>
            </div>

            <h3 className="font-bold text-sm text-navy-900 mb-2">Preview (First 5 rows)</h3>
            <div className="overflow-x-auto bg-slate-50 rounded-lg border border-slate-200 mb-6">
              <table className="w-full text-xs">
                <thead className="bg-slate-100">
                  <tr>
                    {preview.length > 0 && Object.keys(preview[0]).map((key) => (
                      <th key={key} className="px-3 py-2 text-left font-medium text-slate-600">{key}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-t border-slate-200">
                      {Object.values(row).map((val: any, j) => (
                        <td key={j} className="px-3 py-2 text-slate-600">{val}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <button
              onClick={handleUpload}
              disabled={uploading}
              className="w-full bg-navy-900 text-white py-3 rounded-xl font-medium hover:bg-navy-800 transition-colors shadow-lg shadow-navy-900/20 disabled:opacity-50"
            >
              {uploading ? 'Processing...' : 'Confirm Import'}
            </button>
          </div>
        )}
      </div>

      <div className="bg-blue-50 p-4 rounded-xl border border-blue-100 text-sm text-blue-800">
        <h4 className="font-bold mb-2 flex items-center gap-2">
          <Check size={16} />
          Required Columns
        </h4>
        <p>Ensure your CSV has the following headers (case-insensitive):</p>
        <ul className="list-disc list-inside mt-2 space-y-1 opacity-80">
          <li>Item Description</li>
          <li>Quantity</li>
          <li>UPC (Required, Unique)</li>
          <li>Number</li>
          <li>Tag Names</li>
        </ul>
      </div>
    </div>
  );
}
