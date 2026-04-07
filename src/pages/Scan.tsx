import React, { useMemo } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../hooks/useToast';
import { useServerInfo } from '../hooks/useServerInfo';
import { useScanSession } from '../hooks/useScanSession';
import { useHardwareScanner } from '../hooks/useHardwareScanner';
import { useDraftManagement } from '../hooks/useDraftManagement';
import { useEditItem } from '../hooks/useEditItem';
import { useCommitModal } from '../hooks/useCommitModal';
import { ScannerPanel } from '../components/scan/ScannerPanel';
import { FeedPanel } from '../components/scan/FeedPanel';
import { EditItemModal } from '../components/scan/EditItemModal';
import { CommitModal } from '../components/scan/CommitModal';
import { ToastContainer } from '../components/scan/ToastContainer';

const RENDER_LIMIT = 150;

export default function Scan() {
  const prefersReducedMotion = useReducedMotion();
  const { user } = useAuth();
  const isTaker = user?.role === 'taker';

  const { toasts, addToast } = useToast();
  const { serverInfo, ipLoading } = useServerInfo();

  const session = useScanSession(addToast);
  const scanner = useHardwareScanner(session.sessionId, session.otp, session.uiStatus, addToast);

  const draft = useDraftManagement({
    sessionId: session.sessionId,
    sessionLabel: session.sessionLabel,
    setSessionStatus: session.setSessionStatus,
    setSessionLabel: session.setSessionLabel,
    setDraftAlert: session.setDraftAlert,
    setItems: (items) => session.setItems(() => items),
    setSelectedIds: session.setSelectedIds,
    manuallyDeselectedRef: session.manuallyDeselectedRef,
    sessionStartTimeRef: session.sessionStartTimeRef,
    idleAlertFiredRef: session.idleAlertFiredRef,
    lastLongSessionAlertRef: session.lastLongSessionAlertRef,
    createSession: session.createSession,
    addToast,
  });

  const edit = useEditItem(session.sessionId, session.setItems, session.setSelectedIds, addToast);

  const commit = useCommitModal(
    session.sessionId,
    session.items,
    session.selectedIds,
    session.isBusyRef,
    session.lastPollAtRef,
    session.setItems,
    session.setSelectedIds,
    session.setUiStatus,
    session.setStatusMessage,
    addToast,
  );

  const mobileUrl = useMemo(() => {
    if (!session.sessionId || !session.otp) return '';
    const base = serverInfo?.mobileUrl ?? globalThis.location.origin;
    return `${base}/mobile-scan/${session.sessionId}?otp=${session.otp}`;
  }, [session.sessionId, session.otp, serverInfo]);

  const visibleItems = useMemo(() => session.items.slice(0, RENDER_LIMIT), [session.items]);

  return (
    <div className="space-y-6">
      {draft.showDraftPopover && (
        <div
          role="presentation"
          aria-hidden="true"
          className="fixed inset-0 z-20"
          onClick={() => draft.setShowDraftPopover(false)}
        />
      )}

      {/* Page header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-navy-900">Live Scan Center</h2>
          <p className="text-slate-500">
            {scanner.scanInputMode === 'hardware'
              ? 'Hardware scanner mode — pull the trigger on any barcode'
              : 'Connect a mobile device to start remote scanning'}
          </p>
        </div>
        <button
          onClick={session.handleResetSession}
          disabled={session.sessionLoading || session.isRefreshing || session.uiStatus === 'committing'}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {session.isRefreshing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
          Reset Session
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {session.sessionStatus !== 'draft' && (
          <ScannerPanel
            scanInputMode={scanner.scanInputMode}
            setScanInputMode={scanner.setScanInputMode}
            serverInfo={serverInfo}
            ipLoading={ipLoading}
            otp={session.otp}
            mobileUrl={mobileUrl}
            uiStatus={session.uiStatus}
            lastHardwareScan={scanner.lastHardwareScan}
            onResetSession={session.handleResetSession}
          />
        )}

        <FeedPanel
          items={session.items}
          visibleItems={visibleItems}
          selectedIds={session.selectedIds}
          uiStatus={session.uiStatus}
          statusMessage={session.statusMessage}
          sessionStatus={session.sessionStatus}
          sessionLabel={session.sessionLabel}
          pollError={session.pollError}
          draftAlert={session.draftAlert}
          isTaker={isTaker}
          prefersReducedMotion={prefersReducedMotion}
          scanInputMode={scanner.scanInputMode}
          showDraftPopover={draft.showDraftPopover}
          draftNameInput={draft.draftNameInput}
          RENDER_LIMIT={RENDER_LIMIT}
          onToggleItem={session.toggleItem}
          onCommitClick={commit.openCommitModal}
          onOpenDraftPopover={draft.openDraftPopover}
          onCloseDraftPopover={() => draft.setShowDraftPopover(false)}
          onDraftNameChange={draft.setDraftNameInput}
          onConfirmDraft={draft.handleConfirmDraft}
          onResumeScan={draft.handleResumeScan}
          onSaveDraft={draft.handleSaveDraft}
          onDismissAlert={() => session.setDraftAlert({ message: '', visible: false })}
          onClearAllItems={draft.handleClearAllItems}
          onDeleteDraft={draft.handleDeleteDraft}
          onEditItem={edit.openEdit}
          onDeleteItem={edit.deleteItem}
          onSelectAll={() => session.setSelectedIds(new Set(session.items.map(i => i.id)))}
          onDeselectAll={() => session.setSelectedIds(new Set())}
          onSelectNewOnly={() => session.setSelectedIds(new Set(
            session.items.filter(i => i.lookup_status === 'new_candidate' && !i.exists_in_inventory).map(i => i.id)
          ))}
        />
      </div>

      <EditItemModal
        editItem={edit.editItem}
        editSaving={edit.editSaving}
        prefersReducedMotion={prefersReducedMotion}
        onChange={edit.setEditItem}
        onSave={edit.saveEdit}
        onClose={() => edit.setEditItem(null)}
      />

      <CommitModal
        show={commit.showCommitModal}
        items={session.items}
        selectedIds={session.selectedIds}
        categories={commit.categories}
        categoriesLoading={commit.categoriesLoading}
        itemCategories={commit.itemCategories}
        modalSelectedIds={commit.modalSelectedIds}
        bulkCategoryId={commit.bulkCategoryId}
        prefersReducedMotion={prefersReducedMotion}
        onClose={() => commit.setShowCommitModal(false)}
        onConfirmCommit={commit.confirmCommit}
        onSetItemCategory={(itemId, catId) => {
          commit.setItemCategories(prev => {
            const next = new Map(prev);
            catId ? next.set(itemId, catId) : next.delete(itemId);
            return next;
          });
        }}
        onSetModalSelectedIds={commit.setModalSelectedIds}
        onSetBulkCategoryId={commit.setBulkCategoryId}
        onApplyBulk={() => {
          if (!commit.bulkCategoryId) return;
          commit.setItemCategories(prev => {
            const next = new Map(prev);
            const commitItems = session.items.filter(i => session.selectedIds.has(i.id));
            const targets = commit.modalSelectedIds.size > 0
              ? [...commit.modalSelectedIds]
              : commitItems.map(i => i.id);
            targets.forEach(id => next.set(id, commit.bulkCategoryId!));
            return next;
          });
          commit.setModalSelectedIds(new Set());
        }}
      />

      <ToastContainer toasts={toasts} prefersReducedMotion={prefersReducedMotion} />
    </div>
  );
}
