import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { confirmImport, uploadFile } from '../components/import/importApi';
import type { DestinationField, ImportState } from '../components/import/types';

const initialState: ImportState = {
  step: 'upload',
  file: null,
  sheets: [],
  activeSheet: 0,
  result: null,
  parseError: null,
  isParsing: false,
};

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useImportWorkflow() {
  const [state, setState] = useState<ImportState>(initialState);

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;

    try {
      const file = input.files?.[0];
      if (!file) return;

      setState(prev => ({
        ...prev,
        step: 'upload',
        file,
        sheets: [],
        activeSheet: 0,
        result: null,
        parseError: null,
        isParsing: true,
      }));

      const sheets = await uploadFile(file);

      setState(prev => ({
        ...prev,
        step: 'map',
        sheets,
        activeSheet: 0,
        isParsing: false,
      }));
    } catch (error) {
      const message = getErrorMessage(error, 'Network error - could not reach server');
      setState(prev => ({ ...prev, isParsing: false, parseError: message }));
    } finally {
      input.value = '';
    }
  };

  const handleMappingChange = (header: string, destination: DestinationField) => {
    setState(prev => {
      const sheets = prev.sheets.map((sheet, index) =>
        index === prev.activeSheet
          ? { ...sheet, mapping: { ...sheet.mapping, [header]: destination } }
          : sheet
      );

      return { ...prev, sheets };
    });
  };

  const setActiveSheet = (index: number) => {
    setState(prev => {
      if (index < 0 || index >= prev.sheets.length) return prev;
      return { ...prev, activeSheet: index };
    });
  };

  const applyToAllSheets = () => {
    setState(prev => {
      const sourceMapping = prev.sheets[prev.activeSheet]?.mapping;
      if (!sourceMapping) return prev;

      return {
        ...prev,
        sheets: prev.sheets.map(sheet => ({ ...sheet, mapping: { ...sourceMapping } })),
      };
    });
  };

  const handleConfirm = async () => {
    setState(prev => ({ ...prev, step: 'importing', parseError: null }));

    try {
      const result = await confirmImport(state.sheets);
      setState(prev => ({ ...prev, step: 'done', result }));
    } catch (error) {
      const message = getErrorMessage(error, 'Import failed');
      setState(prev => ({ ...prev, step: 'map', parseError: message }));
    }
  };

  const reset = () => setState(initialState);

  const activeSheet = state.sheets[state.activeSheet] ?? null;
  const isMultiSheet = state.sheets.length > 1;
  const mappedCount = activeSheet
    ? Object.values(activeSheet.mapping).filter(value => value !== '__ignore__').length
    : 0;
  const totalRows = state.sheets.reduce((total, sheet) => total + sheet.rowCount, 0);

  return {
    state,
    activeSheet,
    isMultiSheet,
    mappedCount,
    totalRows,
    handleFileChange,
    handleMappingChange,
    setActiveSheet,
    applyToAllSheets,
    handleConfirm,
    reset,
  };
}
