import React from 'react';
import { useReducedMotion } from 'motion/react';
import { ImportHeader } from './ImportHeader';
import { ImportMappingPanel } from './ImportMappingPanel';
import { ImportResultPanel } from './ImportResultPanel';
import { ImportUploadPanel } from './ImportUploadPanel';
import { useImportWorkflow } from '../../hooks/useImportWorkflow';

export function ImportScreen() {
  const prefersReducedMotion = useReducedMotion();
  const workflow = useImportWorkflow();

  return (
    <div className="space-y-6">
      <ImportHeader step={workflow.state.step} />

      {workflow.state.step === 'upload' && (
        <ImportUploadPanel
          isParsing={workflow.state.isParsing}
          parseError={workflow.state.parseError}
          onFileChange={workflow.handleFileChange}
        />
      )}

      {(workflow.state.step === 'map' || workflow.state.step === 'importing') &&
        workflow.activeSheet && (
          <ImportMappingPanel
            fileName={workflow.state.file?.name ?? null}
            sheets={workflow.state.sheets}
            activeSheet={workflow.activeSheet}
            activeSheetIndex={workflow.state.activeSheet}
            isMultiSheet={workflow.isMultiSheet}
            isImporting={workflow.state.step === 'importing'}
            parseError={workflow.state.parseError}
            totalRows={workflow.totalRows}
            mappedCount={workflow.mappedCount}
            onReset={workflow.reset}
            onSelectSheet={workflow.setActiveSheet}
            onApplyToAllSheets={workflow.applyToAllSheets}
            onMappingChange={workflow.handleMappingChange}
            onConfirm={workflow.handleConfirm}
          />
        )}

      {workflow.state.step === 'done' && workflow.state.result && (
        <ImportResultPanel
          fileName={workflow.state.file?.name ?? null}
          result={workflow.state.result}
          sheets={workflow.state.sheets}
          prefersReducedMotion={prefersReducedMotion}
          onReset={workflow.reset}
        />
      )}
    </div>
  );
}
