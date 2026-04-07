import React from 'react';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';
import { IMPORT_STEPS } from './types';
import type { UploadStep } from './types';

const STEP_LABELS = {
  upload: 'Upload File',
  map: 'Map Columns',
  done: 'Done',
} as const;

interface Props {
  step: UploadStep;
}

export function ImportHeader({ step }: Readonly<Props>) {
  return (
    <>
      <div>
        <h2 className="text-2xl font-bold text-navy-900">Import Wizard</h2>
        <p className="text-slate-500">Upload Excel, CSV, or JSON files to bulk sync inventory</p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        {IMPORT_STEPS.map((currentStep, index) => {
          const isActive = step === currentStep || (step === 'importing' && currentStep === 'map');
          const isComplete = step === 'done' || (currentStep === 'upload' && step !== 'upload');

          return (
            <React.Fragment key={currentStep}>
              <div
                className={cn(
                  'flex items-center gap-1.5 rounded-full px-3 py-1.5 font-medium transition-colors',
                  isActive
                    ? 'bg-navy-900 text-white'
                    : isComplete
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-500'
                )}
              >
                {isComplete && currentStep !== 'done' ? (
                  <Check size={13} />
                ) : (
                  <span>{index + 1}</span>
                )}
                {STEP_LABELS[currentStep]}
              </div>
              {index < IMPORT_STEPS.length - 1 && (
                <ChevronRight size={16} className="text-slate-300" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </>
  );
}
