import { useState } from 'react';
import type { ChangeEvent } from 'react';
import { confirmImport, uploadFile } from '../components/import/importApi';
import {
  applyMappingToMatchingHeaders,
  getImportMappingIssues,
  getMappedColumns,
  setMappingDestination,
} from '../components/import/mapping';
import type { DestinationField, ImportState } from '../components/import/types';

//Import wizard - file parse, column mapping and import.
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

  const handleFile = async (file: File) => {
    try {
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
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    if (file) await handleFile(file);
    input.value = '';
  };

  const handleMappingChange = (header: string, destination: DestinationField) => {
    setState(prev => {
      const sheets = prev.sheets.map((sheet, index) =>
        index === prev.activeSheet
          ? { ...sheet, mapping: setMappingDestination(sheet, header, destination) }
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

  const setSheetCategoryName = (index: number, categoryName: string) => {
    setState(prev => {
      if (index < 0 || index >= prev.sheets.length) return prev;
      return {
        ...prev,
        sheets: prev.sheets.map((sheet, sheetIndex) =>
          sheetIndex === index ? { ...sheet, categoryName: categoryName || null } : sheet
        ),
      };
    });
  };

  const applyToAllSheets = () => {
    setState(prev => {
      if (!prev.sheets[prev.activeSheet]) return prev;

      return {
        ...prev,
        sheets: applyMappingToMatchingHeaders(prev.sheets, prev.activeSheet),
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
  const mappedCount = activeSheet ? getMappedColumns(activeSheet).length : 0;
  const totalRows = state.sheets.reduce((total, sheet) => total + sheet.rowCount, 0);
  const mappingIssues = getImportMappingIssues(state.sheets);

  return {
    state,
    activeSheet,
    isMultiSheet,
    mappedCount,
    totalRows,
    mappingIssues,
    mappingsReady: state.sheets.length > 0 && mappingIssues.length === 0,
    handleFileChange,
    handleFile,
    handleMappingChange,
    setActiveSheet,
    setSheetCategoryName,
    applyToAllSheets,
    handleConfirm,
    reset,
  };
}
