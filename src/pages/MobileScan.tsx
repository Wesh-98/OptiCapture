import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Html5QrcodeScanner } from 'html5-qrcode';
import { motion } from 'motion/react';
import { Wifi, CheckCircle, Barcode, AlertTriangle } from 'lucide-react';

export default function MobileScan() {
  const { sessionId } = useParams();
  const [lastScanned, setLastScanned] = useState<string | null>(null);
  const [scanCount, setScanCount] = useState(0);
  const [status, setStatus] = useState<'scanning' | 'success' | 'error'>('scanning');
  const [scanner, setScanner] = useState<Html5QrcodeScanner | null>(null);

  useEffect(() => {
    const newScanner = new Html5QrcodeScanner(
      "mobile-reader",
      { 
        fps: 10, 
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0
      },
      /* verbose= */ false
    );

    newScanner.render(onScanSuccess, onScanFailure);
    setScanner(newScanner);

    return () => {
      newScanner.clear().catch(console.error);
    };
  }, []);

  const onScanSuccess = async (decodedText: string) => {
    // Prevent rapid duplicate scans if needed, or allow for quantity
    // For now, we just send it.
    
    try {
      // Provide immediate feedback
      setStatus('success');
      if (navigator.vibrate) navigator.vibrate(200);

      const res = await fetch(`/api/session/${sessionId}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upc: decodedText }),
      });

      if (res.ok) {
        setLastScanned(decodedText);
        setScanCount(prev => prev + 1);
        setTimeout(() => setStatus('scanning'), 1500);
      } else {
        setStatus('error');
      }
    } catch (err) {
      console.error(err);
      setStatus('error');
    }
  };

  const onScanFailure = (error: any) => {
    // console.warn(error);
  };

  return (
    <div className="min-h-screen bg-black text-white flex flex-col">
      <div className="p-4 bg-navy-900 flex items-center justify-between border-b border-navy-800">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-mono text-xs text-emerald-400">LINKED: {sessionId?.substring(0, 6)}...</span>
        </div>
        <Wifi size={16} className="text-emerald-500" />
      </div>

      <div className="flex-1 flex flex-col p-4 gap-4">
        <div className="bg-navy-800 rounded-2xl overflow-hidden border border-navy-700 relative shadow-2xl">
          <div id="mobile-reader" className="w-full h-full"></div>
          
          {/* Overlay Status */}
          {status === 'success' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.5 }}
              animate={{ opacity: 1, scale: 1 }}
              className="absolute inset-0 flex items-center justify-center bg-emerald-500/20 backdrop-blur-sm z-10"
            >
              <div className="bg-white rounded-full p-4 shadow-xl">
                <CheckCircle size={48} className="text-emerald-600" />
              </div>
            </motion.div>
          )}
        </div>

        <div className="bg-navy-900 p-6 rounded-2xl border border-navy-800 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <span className="text-slate-400 text-sm uppercase tracking-wider font-bold">Session Stats</span>
            <Barcode className="text-slate-500" />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-navy-950 p-4 rounded-xl border border-navy-800">
              <p className="text-xs text-slate-500 mb-1">Total Scanned</p>
              <p className="text-3xl font-mono font-bold text-white">{scanCount}</p>
            </div>
            <div className="bg-navy-950 p-4 rounded-xl border border-navy-800">
              <p className="text-xs text-slate-500 mb-1">Last Item</p>
              <p className="text-sm font-mono font-bold text-emerald-400 truncate">
                {lastScanned || '--'}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-auto text-center p-4">
          <p className="text-xs text-slate-600">
            Keep this tab open while scanning.
            <br />
            Items are synced instantly to the dashboard.
          </p>
        </div>
      </div>
    </div>
  );
}
