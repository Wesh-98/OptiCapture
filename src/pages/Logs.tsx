import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Activity } from 'lucide-react';

interface Log {
  id: number;
  action: string;
  details: string;
  username: string;
  timestamp: string;
}

export default function Logs() {
  const [logs, setLogs] = useState<Log[]>([]);

  useEffect(() => {
    fetch('/api/logs')
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Failed to fetch logs');
      })
      .then(setLogs)
      .catch(console.error);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-navy-900">Activity Logs</h2>
        <p className="text-slate-500">Audit trail of all system actions</p>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Time</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">User</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-4 text-sm text-slate-500 whitespace-nowrap">
                    {format(new Date(log.timestamp), 'MMM d, yyyy HH:mm:ss')}
                  </td>
                  <td className="px-6 py-4 text-sm font-medium text-navy-900">
                    {log.username}
                  </td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                      log.action === 'CREATE' ? 'bg-green-100 text-green-700' :
                      log.action === 'UPDATE' ? 'bg-blue-100 text-blue-700' :
                      log.action === 'DELETE' ? 'bg-red-100 text-red-700' :
                      'bg-slate-100 text-slate-700'
                    }`}>
                      {log.action}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-slate-600">
                    {log.details}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
