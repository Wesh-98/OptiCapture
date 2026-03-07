import React, { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { motion, AnimatePresence } from 'motion/react';
import { Smartphone, RefreshCw, CheckCircle, ArrowRight, Save, Trash2, Image as ImageIcon } from 'lucide-react';
import { cn } from '../lib/utils';

interface SessionItem {
  id: number;
  upc: string;
  quantity: number;
  item_name: string | null;
  image: string | null;
  scanned_at: string;
}

export default function Scan() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<SessionItem[]>([]);
  const [isPolling, setIsPolling] = useState(false);

  // Initialize Session
  useEffect(() => {
    createSession();
  }, []);

  // Poll for updates
  useEffect(() => {
    if (!sessionId) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/session/${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          // Only update if data changed to avoid jitter, or just simple replace for now
          setItems(data);
        }
      } catch (err) {
        console.error("Polling error", err);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, [sessionId]);

  const createSession = async () => {
    try {
      const res = await fetch('/api/session/create', { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        setSessionId(data.sessionId);
        setItems([]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const commitSession = async () => {
    if (!sessionId || items.length === 0) return;
    
    if (!confirm(`Commit ${items.length} scanned items to main inventory?`)) return;

    try {
      const res = await fetch(`/api/session/${sessionId}/commit`, { method: 'POST' });
      if (res.ok) {
        alert('Session committed successfully!');
        createSession(); // Start fresh
      } else {
        alert('Failed to commit session');
      }
    } catch (err) {
      console.error(err);
      alert('Error committing session');
    }
  };

  const mobileUrl = sessionId ? `${window.location.origin}/mobile-scan/${sessionId}` : '';

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-navy-900">Live Scan Command Center</h2>
          <p className="text-slate-500">Connect a mobile device to start remote scanning</p>
        </div>
        <button
          onClick={createSession}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <RefreshCw size={16} />
          Reset Session
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Connection Card */}
        <div className="lg:col-span-1">
          <div className="bg-navy-900 text-white p-6 rounded-2xl shadow-xl overflow-hidden relative">
            <div className="absolute top-0 right-0 p-32 bg-navy-800 rounded-full blur-3xl -mr-16 -mt-16 opacity-50"></div>
            
            <div className="relative z-10 text-center">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-navy-800 mb-4 border border-navy-700">
                <Smartphone className="text-emerald-400" size={24} />
              </div>
              <h3 className="text-lg font-bold mb-2">Connect Scanner</h3>
              <p className="text-navy-200 text-sm mb-6">
                Scan this QR code with your mobile device to link it to this dashboard.
              </p>

              <div className="bg-white p-4 rounded-xl inline-block shadow-lg mb-4">
                {sessionId ? (
                  <QRCodeSVG value={mobileUrl} size={180} />
                ) : (
                  <div className="w-[180px] h-[180px] bg-slate-100 animate-pulse rounded-lg" />
                )}
              </div>

              <div className="flex items-center justify-center gap-2 text-xs text-navy-300 font-mono bg-navy-950/50 py-2 rounded-lg">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Listening for connection...
              </div>
            </div>
          </div>
        </div>

        {/* Live Feed */}
        <div className="lg:col-span-2 flex flex-col h-[600px] bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50/50">
            <div className="flex items-center gap-3">
              <div className="h-8 w-1 bg-emerald-500 rounded-full" />
              <div>
                <h3 className="font-bold text-navy-900">Incoming Feed</h3>
                <p className="text-xs text-slate-500">{items.length} items scanned</p>
              </div>
            </div>
            
            {items.length > 0 && (
              <button
                onClick={commitSession}
                className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-900/20"
              >
                <Save size={18} />
                Commit to Inventory
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50">
            <AnimatePresence mode='popLayout'>
              {items.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                  <p>Ready for scans...</p>
                </div>
              ) : (
                items.map((item, index) => (
                  <motion.div
                    key={item.id} // Use unique ID from DB
                    initial={{ opacity: 0, y: 20, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    layout
                    className={cn(
                      "bg-white p-4 rounded-xl border shadow-sm flex items-center justify-between",
                      index === 0 ? "border-emerald-200 shadow-emerald-100 ring-1 ring-emerald-100" : "border-slate-100"
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200">
                        {item.image ? (
                          <img src={item.image} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon size={20} className="text-slate-400" />
                        )}
                      </div>
                      <div>
                        <p className="font-bold text-navy-900">
                          {item.item_name || <span className="text-slate-400 italic">Unknown Item</span>}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-slate-500 font-mono">
                          <span>{item.upc}</span>
                          <span className="w-1 h-1 rounded-full bg-slate-300" />
                          <span>{new Date(item.scanned_at).toLocaleTimeString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="px-3 py-1 bg-navy-50 text-navy-700 rounded-lg font-mono font-bold">
                        x{item.quantity}
                      </div>
                      {index === 0 && (
                        <div className="flex items-center gap-1 text-xs text-emerald-600 font-bold uppercase tracking-wider">
                          <CheckCircle size={14} />
                          New
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
