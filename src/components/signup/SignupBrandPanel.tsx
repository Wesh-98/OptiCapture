import { BarChart3, Layers, Smartphone } from 'lucide-react';

const features = [
  {
    description: 'Manage multiple locations from one platform',
    icon: Layers,
    title: 'Multi-store ready',
  },
  {
    description: 'Scan via phone camera or USB/Bluetooth scanner',
    icon: Smartphone,
    title: 'Barcode scanning',
  },
  {
    description: 'Live inventory counts across your team',
    icon: BarChart3,
    title: 'Real-time sync',
  },
] as const;

export function SignupBrandPanel() {
  return (
    <div className="hidden lg:flex lg:w-2/5 flex-col justify-between p-12 bg-navy-900">
      <div>
        <h1 className="text-4xl font-bold text-white tracking-tight">OptiCapture</h1>
        <p className="text-slate-400 mt-2 text-lg">Smart inventory for modern stores</p>
      </div>

      <div className="space-y-6">
        {features.map(({ description, icon: Icon, title }) => (
          <div key={title} className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 bg-navy-700">
              <Icon size={20} className="text-blue-400" />
            </div>
            <div>
              <p className="font-semibold text-white">{title}</p>
              <p className="text-slate-400 text-sm mt-0.5">{description}</p>
            </div>
          </div>
        ))}
      </div>

      <p className="text-slate-600 text-sm">
        {`(c) ${new Date().getFullYear()} OptiCapture. All rights reserved.`}
      </p>
    </div>
  );
}
