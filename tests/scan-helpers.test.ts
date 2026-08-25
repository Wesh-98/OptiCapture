import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  autoSelectIncoming,
  buildSessionStorageEntries,
  buildCreateSessionRequest,
  buildPollUrl,
  getCreateSessionFailureState,
  getSessionActivationAction,
  getSessionExpiryWarningMessage,
  mergeSessionItems,
  parseSessionEnvelope,
  reconcileSelectedIds,
  resolveCreatedSession,
  resolveParamResumeMatch,
  resolveStoredSessionResume,
  shouldClearStoredSessionForStore,
  toggleSessionSelection,
  type PollCursor,
} from '../src/hooks/useScanSession.js';
import {
  buildSubmitScanRequest,
  buildMobileSessionSnapshot,
  canSubmitManualScan,
  classifySessionSyncResponse,
  countScannedItems,
  evaluateDetectedCameraCode,
  evaluateCameraIdleProgress,
  evaluateUndetectedCameraFrame,
  getCameraLifecycleAction,
  getCameraRuntimeError,
  getSubmitScanGuard,
  normalizeQuantity,
  normalizeScannedItems,
  normalizeUnit,
  parseScanResponsePayload,
  readScanErrorMessage,
  resolveSubmittedScanItem,
  shouldStopIdleCamera,
  shouldStartCameraScanner,
  toScannedItem,
  upsertScannedItem,
} from '../src/hooks/useMobileScan.js';
import {
  buildHardwareScanRequest,
  canSubmitHardwareScan,
  getHardwareScanToast,
  isEditableTarget,
  readStoredHardwareScanInputMode,
  reduceHardwareScanKey,
  shouldListenForHardwareScanner,
} from '../src/hooks/useHardwareScanner.js';
import {
  buildCommitAssignments,
  getBulkCategoryTargetIds,
  getCommitEligibleItems,
  isCommitEligibleItem,
} from '../src/hooks/useCommitModal.js';
import {
  buildCameraErrorMessage,
  clearScannerVideo,
  getDeviceId,
  stopScannerResources,
} from '../src/lib/mobileScanScanner.js';
import type { SessionItem } from '../src/components/scan/types.js';
import {
  evaluateSessionDraftAlert,
  getLatestCursor,
  getPollFailureOutcome,
} from '../src/hooks/useScanSession.js';

function makeSessionItem(overrides: Partial<SessionItem> = {}): SessionItem {
  return {
    id: 1,
    upc: '111',
    quantity: 1,
    product_name: 'Item 111',
    brand: null,
    image: null,
    scanned_at: '2026-01-02T10:00:00Z',
    lookup_status: 'unknown',
    source: 'manual',
    exists_in_inventory: 0,
    sale_price: null,
    unit: null,
    updated_at: '2026-01-02T10:00:00Z',
    tag_names: null,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('scan session helpers', () => {
  it('builds poll URLs with and without cursors', () => {
    const cursor: PollCursor = { updatedAt: '2026-01-02T10:00:00Z', id: 42 };

    expect(buildPollUrl('session-1', null)).toBe('/api/session/session-1');
    expect(buildPollUrl('session-1', cursor)).toBe(
      '/api/session/session-1?since_updated_at=2026-01-02T10%3A00%3A00Z&since_id=42'
    );
  });

  it('parses both legacy array payloads and envelope payloads', () => {
    const items = [makeSessionItem()];

    expect(parseSessionEnvelope(items)).toEqual({
      items,
      expiresAt: null,
      status: null,
      label: null,
    });

    expect(
      parseSessionEnvelope({
        items,
        expires_at: '2026-01-03T10:00:00Z',
        status: 'draft',
        label: 'Night shift',
      })
    ).toEqual({
      items,
      expiresAt: '2026-01-03T10:00:00Z',
      status: 'draft',
      label: 'Night shift',
    });
  });

  it('merges incremental session items without duplicating existing ids', () => {
    const prevItems = [
      makeSessionItem({ id: 1, upc: '111' }),
      makeSessionItem({ id: 2, upc: '222' }),
    ];
    const incoming = [
      makeSessionItem({ id: 3, upc: '333' }),
      makeSessionItem({ id: 2, upc: '222', product_name: 'Updated Item 222' }),
    ];

    expect(mergeSessionItems(prevItems, incoming, true)).toEqual(incoming);
    expect(mergeSessionItems(prevItems, incoming, false)).toEqual([
      incoming[0],
      incoming[1],
      prevItems[0],
    ]);
  });

  it('auto-selects new candidates and reconciles removed selections', () => {
    const incoming = [
      makeSessionItem({ id: 10, lookup_status: 'new_candidate', exists_in_inventory: 0 }),
      makeSessionItem({ id: 11, lookup_status: 'existing', exists_in_inventory: 1 }),
      makeSessionItem({ id: 12, lookup_status: 'new_candidate', exists_in_inventory: 0 }),
    ];

    expect(autoSelectIncoming(new Set([5]), incoming, new Set([12]))).toEqual(new Set([5, 10]));

    expect(
      reconcileSelectedIds(
        new Set([5, 6, 12]),
        [
          makeSessionItem({ id: 5 }),
          makeSessionItem({ id: 10, lookup_status: 'new_candidate', exists_in_inventory: 0 }),
        ],
        incoming,
        new Set([12])
      )
    ).toEqual(new Set([5, 10]));
  });

  it('finds the latest poll cursor from the first item with an update timestamp', () => {
    expect(
      getLatestCursor([
        makeSessionItem({ id: 8, updated_at: null }),
        makeSessionItem({ id: 9, updated_at: '2026-01-02T11:00:00Z' }),
        makeSessionItem({ id: 10, updated_at: '2026-01-02T10:00:00Z' }),
      ])
    ).toEqual({
      updatedAt: '2026-01-02T11:00:00Z',
      id: 9,
    });

    expect(getLatestCursor([makeSessionItem({ id: 1, updated_at: null })])).toBeNull();
  });

  it('evaluates draft alerts and poll failure escalation without hook rendering', () => {
    expect(
      evaluateSessionDraftAlert({
        incomingCount: 0,
        sessionStatus: 'active',
        sessionStartTime: Date.now() - 31 * 60 * 1000,
        lastLongSessionAlertAt: null,
        lastItemAddedAt: Date.now(),
        idleAlertFired: false,
        now: Date.now(),
      })
    ).toEqual({
      alert: null,
      nextLastLongSessionAlertAt: null,
      nextIdleAlertFired: false,
    });

    expect(
      evaluateSessionDraftAlert({
        incomingCount: 3,
        sessionStatus: 'active',
        sessionStartTime: 1000,
        lastLongSessionAlertAt: null,
        lastItemAddedAt: 50 * 60 * 1000,
        idleAlertFired: false,
        now: 31 * 60 * 1000,
      })
    ).toEqual({
      alert: {
        message: "You've been scanning for 30 min - save as draft to protect your progress.",
        visible: true,
      },
      nextLastLongSessionAlertAt: 31 * 60 * 1000,
      nextIdleAlertFired: false,
    });

    expect(
      evaluateSessionDraftAlert({
        incomingCount: 3,
        sessionStatus: 'active',
        sessionStartTime: 1000,
        lastLongSessionAlertAt: 20 * 60 * 1000,
        lastItemAddedAt: 0,
        idleAlertFired: false,
        now: 35 * 60 * 1000,
      })
    ).toEqual({
      alert: null,
      nextLastLongSessionAlertAt: 20 * 60 * 1000,
      nextIdleAlertFired: false,
    });

    expect(
      evaluateSessionDraftAlert({
        incomingCount: 2,
        sessionStatus: 'active',
        sessionStartTime: null,
        lastLongSessionAlertAt: null,
        lastItemAddedAt: 1,
        idleAlertFired: false,
        now: 11 * 60 * 1000 + 1,
      })
    ).toEqual({
      alert: {
        message: 'No new items scanned for 10 min - save as draft to protect your progress.',
        visible: true,
      },
      nextLastLongSessionAlertAt: null,
      nextIdleAlertFired: true,
    });

    expect(getPollFailureOutcome(1)).toEqual({
      shouldStopPolling: false,
      uiStatus: null,
      statusMessage: null,
      pollError: 'Could not refresh live scan feed.',
    });

    expect(getPollFailureOutcome(3)).toEqual({
      shouldStopPolling: true,
      uiStatus: 'error',
      statusMessage: 'Server is offline or unreachable.',
      pollError: 'Server offline - polling stopped. Restart the server and refresh.',
    });
  });

  it('builds expiry warnings, storage entries, and store-mismatch decisions', () => {
    expect(getSessionExpiryWarningMessage(null, 'active', Date.now())).toBeNull();
    expect(getSessionExpiryWarningMessage('2026-01-02T11:00:00Z', 'draft', Date.now())).toBeNull();
    expect(
      getSessionExpiryWarningMessage(
        '2026-01-02T10:20:00Z',
        'active',
        new Date('2026-01-02T10:00:00Z').getTime()
      )
    ).toBe('Session expires in 20 min - save as draft or commit soon');
    expect(
      getSessionExpiryWarningMessage(
        '2026-01-02T11:10:00Z',
        'active',
        new Date('2026-01-02T10:00:00Z').getTime()
      )
    ).toBeNull();

    expect(buildSessionStorageEntries('session-1', 'otp-1', 7)).toEqual([
      ['scan_session_id', 'session-1'],
      ['scan_otp', 'otp-1'],
      ['scan_store_id', '7'],
    ]);
    expect(buildSessionStorageEntries('session-1', 'otp-1', null)).toEqual([
      ['scan_session_id', 'session-1'],
      ['scan_otp', 'otp-1'],
    ]);

    expect(shouldClearStoredSessionForStore('7', 8)).toBe(true);
    expect(shouldClearStoredSessionForStore('7', 7)).toBe(false);
    expect(shouldClearStoredSessionForStore(null, 7)).toBe(false);
    expect(shouldClearStoredSessionForStore('7', null)).toBe(false);
  });

  it('builds create-session requests and resolves success or failure state', () => {
    expect(buildCreateSessionRequest()).toEqual({
      url: '/api/session/create',
      init: { method: 'POST', credentials: 'include' },
    });

    expect(resolveCreatedSession('created-1', 'otp-created', 4, 444444)).toEqual({
      sessionId: 'created-1',
      otp: 'otp-created',
      sessionStatus: 'active',
      items: [],
      uiStatus: 'ready',
      statusMessage: 'Session ready. Scan the QR code with your phone.',
      sessionStartTime: 444444,
      lastItemAddedAt: 444444,
      idleAlertFired: false,
      lastLongSessionAlertAt: null,
      storageEntries: [
        ['scan_session_id', 'created-1'],
        ['scan_otp', 'otp-created'],
        ['scan_store_id', '4'],
      ],
    });

    expect(getCreateSessionFailureState()).toEqual({
      uiStatus: 'error',
      statusMessage: 'Could not create scan session.',
      sessionId: null,
      otp: null,
      items: [],
    });
  });

  it('resolves resume state from query-param and storage sources', () => {
    expect(
      resolveParamResumeMatch(
        {
          session_id: 'param-1',
          otp: 'otp-param',
          status: 'active',
          label: 'Backroom',
        },
        9,
        123456
      )
    ).toEqual({
      sessionId: 'param-1',
      otp: 'otp-param',
      sessionStatus: 'active',
      sessionLabel: 'Backroom',
      storageEntries: [
        ['scan_session_id', 'param-1'],
        ['scan_otp', 'otp-param'],
        ['scan_store_id', '9'],
      ],
      shouldClearStoredSession: false,
      sessionStartTime: 123456,
      lastItemAddedAt: 123456,
    });

    expect(
      resolveParamResumeMatch(
        {
          session_id: 'param-2',
          otp: 'otp-param-2',
          status: 'completed',
          label: null,
        },
        9,
        999
      )
    ).toEqual({
      sessionId: 'param-2',
      otp: 'otp-param-2',
      sessionStatus: 'completed',
      sessionLabel: null,
      storageEntries: [],
      shouldClearStoredSession: true,
      sessionStartTime: 999,
      lastItemAddedAt: 999,
    });

    expect(
      resolveStoredSessionResume(
        'saved-1',
        'otp-1',
        parseSessionEnvelope({
          items: [
            makeSessionItem({ id: 11, lookup_status: 'new_candidate', exists_in_inventory: 0 }),
            makeSessionItem({ id: 12, lookup_status: 'existing', exists_in_inventory: 1 }),
          ],
          expires_at: '2026-01-03T10:00:00Z',
          status: 'draft',
          label: 'Night count',
        }),
        'active',
        'Fallback label',
        new Set([12]),
        222222
      )
    ).toEqual({
      kind: 'resumed',
      sessionId: 'saved-1',
      otp: 'otp-1',
      sessionStatus: 'draft',
      sessionLabel: 'Night count',
      items: [
        makeSessionItem({ id: 11, lookup_status: 'new_candidate', exists_in_inventory: 0 }),
        makeSessionItem({ id: 12, lookup_status: 'existing', exists_in_inventory: 1 }),
      ],
      uiStatus: 'ready',
      statusMessage: 'Session resumed. Scan the QR code with your phone.',
      selectedIds: new Set([11]),
      lastPollCursor: { updatedAt: '2026-01-02T10:00:00Z', id: 11 },
      sessionStartTime: 222222,
      lastItemAddedAt: 222222,
      expiresAt: '2026-01-03T10:00:00Z',
    });

    expect(
      resolveStoredSessionResume(
        'saved-2',
        'otp-2',
        parseSessionEnvelope({
          items: [],
          status: 'completed',
          label: 'Done',
        }),
        'active',
        null,
        new Set(),
        333333
      )
    ).toEqual({ kind: 'completed' });
  });

  it('decides polling activation and selection toggles without hook rendering', () => {
    expect(getSessionActivationAction(null, 'active')).toBe('stop');
    expect(getSessionActivationAction('session-1', 'active')).toBe('poll');
    expect(getSessionActivationAction('session-1', 'draft')).toBe('poll');
    expect(getSessionActivationAction('session-1', 'completed')).toBe('view_only');

    expect(toggleSessionSelection(new Set([3, 4]), 4, new Set([7]))).toEqual({
      selectedIds: new Set([3]),
      manuallyDeselected: new Set([7, 4]),
    });

    expect(toggleSessionSelection(new Set([3]), 4, new Set([7, 4]))).toEqual({
      selectedIds: new Set([3, 4]),
      manuallyDeselected: new Set([7]),
    });
  });
});

describe('commit modal helpers', () => {
  it('commits only selected new candidate items that are not already in inventory', () => {
    const items = [
      makeSessionItem({ id: 10, lookup_status: 'new_candidate', exists_in_inventory: 0 }),
      makeSessionItem({ id: 11, lookup_status: 'existing', exists_in_inventory: 1 }),
      makeSessionItem({ id: 12, lookup_status: 'unknown', exists_in_inventory: 0 }),
      makeSessionItem({ id: 13, lookup_status: 'new_candidate', exists_in_inventory: 0 }),
    ];
    const selectedIds = new Set([10, 11, 12]);

    expect(isCommitEligibleItem(items[0])).toBe(true);
    expect(isCommitEligibleItem(items[1])).toBe(false);
    expect(isCommitEligibleItem(items[2])).toBe(false);
    expect(getCommitEligibleItems(items, selectedIds).map(item => item.id)).toEqual([10]);
  });

  it('builds assignments and bulk targets from eligible commit items only', () => {
    const items = [
      makeSessionItem({ id: 10, lookup_status: 'new_candidate', exists_in_inventory: 0 }),
      makeSessionItem({ id: 11, lookup_status: 'existing', exists_in_inventory: 1 }),
      makeSessionItem({ id: 12, lookup_status: 'new_candidate', exists_in_inventory: 0 }),
    ];
    const selectedIds = new Set([10, 11, 12]);
    const itemCategories = new Map([
      [10, 4],
      [11, 5],
    ]);

    expect(buildCommitAssignments(items, selectedIds, itemCategories)).toEqual([
      { id: 10, category_id: 4 },
    ]);
    expect(getBulkCategoryTargetIds(items, selectedIds, new Set())).toEqual([10, 12]);
    expect(getBulkCategoryTargetIds(items, selectedIds, new Set([11, 12]))).toEqual([12]);
  });
});

describe('mobile scan helpers', () => {
  it('parses scan responses and extracts human-readable error messages', () => {
    expect(parseScanResponsePayload('{"error":"OTP required"}')).toEqual({
      error: 'OTP required',
    });
    expect(parseScanResponsePayload('not-json')).toBe('not-json');
    expect(readScanErrorMessage({ error: 'Scan failed' }, 'fallback')).toBe('Scan failed');
    expect(readScanErrorMessage({ message: 'ignored' }, 'fallback')).toBe('fallback');
  });

  it('normalizes quantities and units defensively', () => {
    expect(normalizeQuantity(4.9)).toBe(4);
    expect(normalizeQuantity('7')).toBe(7);
    expect(normalizeQuantity('0')).toBe(1);
    expect(normalizeQuantity('not-a-number')).toBe(1);
    expect(normalizeUnit(' each ')).toBe('each');
    expect(normalizeUnit(null)).toBe('');
  });

  it('converts server scan items into sorted UI items', () => {
    const next = toScannedItem({
      id: 9,
      product_name: 'Cola',
      upc: '123',
      unit: '  can ',
      scanned_at: '2026-01-02 10:00:00',
      quantity: '3',
    });

    expect(next).toMatchObject({
      id: 9,
      name: 'Cola',
      upc: '123',
      unit: 'can',
      quantity: 3,
    });
    expect(next?.ts.toISOString()).toBe('2026-01-02T10:00:00.000Z');

    const normalized = normalizeScannedItems([
      { id: 1, upc: 'older', scanned_at: '2026-01-02T09:00:00Z', quantity: 1 },
      { id: 3, upc: 'newest-a', scanned_at: '2026-01-02T11:00:00Z', quantity: 2 },
      { id: 2, upc: 'newest-b', scanned_at: '2026-01-02T11:00:00Z', quantity: 4 },
      { id: 999, scanned_at: '2026-01-02T12:00:00Z' },
    ]);

    expect(normalized.map(item => item.upc)).toEqual(['newest-a', 'newest-b', 'older']);
    expect(countScannedItems(normalized)).toBe(7);

    expect(normalizeScannedItems('not-an-array')).toEqual([]);
    expect(toScannedItem({ product_name: 'Missing UPC' })).toBeNull();
    expect(toScannedItem(null)).toBeNull();
  });

  it('upserts scan rows by id and keeps the newest version first', () => {
    const items = [
      {
        id: 1,
        name: 'Older',
        upc: '111',
        unit: '',
        ts: new Date('2026-01-02T09:00:00Z'),
        quantity: 1,
      },
      {
        id: 2,
        name: 'Existing',
        upc: '222',
        unit: '',
        ts: new Date('2026-01-02T10:00:00Z'),
        quantity: 2,
      },
    ];

    const nextItem = {
      id: 2,
      name: 'Existing Updated',
      upc: '222',
      unit: 'ea',
      ts: new Date('2026-01-02T11:00:00Z'),
      quantity: 5,
    };

    expect(upsertScannedItem(items, nextItem)).toEqual([nextItem, items[0]]);
  });

  it('locks duplicate camera detections until the code disappears from frame', () => {
    const firstResult = evaluateDetectedCameraCode(
      { activeCode: null, missedDetectionCount: 0 },
      ' 012345 ',
      false
    );
    expect(firstResult).toEqual({
      nextState: { activeCode: '012345', missedDetectionCount: 0 },
      acceptedCode: '012345',
    });

    const duplicateResult = evaluateDetectedCameraCode(firstResult.nextState, '012345', false);
    expect(duplicateResult).toEqual({
      nextState: { activeCode: '012345', missedDetectionCount: 0 },
      acceptedCode: null,
    });

    const busyResult = evaluateDetectedCameraCode(firstResult.nextState, '999999', true);
    expect(busyResult).toEqual({
      nextState: { activeCode: '012345', missedDetectionCount: 0 },
      acceptedCode: null,
    });
  });

  it('rearms camera scanning after enough missed detections', () => {
    const startState = { activeCode: '012345', missedDetectionCount: 0 };

    const missOne = evaluateUndetectedCameraFrame(startState, false);
    expect(missOne).toEqual({
      nextState: { activeCode: '012345', missedDetectionCount: 1 },
      rearmed: false,
    });

    const missTwo = evaluateUndetectedCameraFrame(missOne.nextState, false);
    expect(missTwo).toEqual({
      nextState: { activeCode: '012345', missedDetectionCount: 2 },
      rearmed: false,
    });

    const missThree = evaluateUndetectedCameraFrame(missTwo.nextState, false);
    expect(missThree).toEqual({
      nextState: { activeCode: null, missedDetectionCount: 0 },
      rearmed: true,
    });

    expect(
      evaluateUndetectedCameraFrame({ activeCode: '012345', missedDetectionCount: 1 }, true)
    ).toEqual({
      nextState: { activeCode: '012345', missedDetectionCount: 1 },
      rearmed: false,
    });
  });

  it('starts the camera only when the session is ready and no scanner is already active', () => {
    expect(shouldStartCameraScanner('camera', true, 'active', null, false, false)).toBe(true);
    expect(shouldStartCameraScanner('manual', true, 'active', null, false, false)).toBe(false);
    expect(shouldStartCameraScanner('camera', false, 'active', null, false, false)).toBe(false);
    expect(shouldStartCameraScanner('camera', true, 'draft', null, false, false)).toBe(false);
    expect(shouldStartCameraScanner('camera', true, 'active', 'Session error', false, false)).toBe(
      false
    );
    expect(shouldStartCameraScanner('camera', true, 'active', null, true, false)).toBe(false);
    expect(shouldStartCameraScanner('camera', true, 'active', null, false, true)).toBe(false);
  });

  it('builds scan-session snapshots and classifies session sync responses', () => {
    expect(
      buildMobileSessionSnapshot({
        items: [
          { id: 1, upc: 'older', scanned_at: '2026-01-02T09:00:00Z', quantity: 1 },
          { id: 2, upc: 'newer', scanned_at: '2026-01-02T10:00:00Z', quantity: '3' },
        ],
        status: 'draft',
      })
    ).toMatchObject({
      scanCount: 4,
      sessionStatus: 'draft',
    });

    expect(
      buildMobileSessionSnapshot({
        items: [],
        status: 'unexpected',
      })
    ).toMatchObject({
      items: [],
      scanCount: 0,
      sessionStatus: null,
    });

    expect(classifySessionSyncResponse(false, 401, { error: 'OTP expired' }, null, false)).toEqual({
      kind: 'fatal_error',
      message: 'OTP expired',
      shouldToast: true,
    });

    expect(
      classifySessionSyncResponse(false, 401, { error: 'OTP expired' }, 'OTP expired', false)
    ).toEqual({
      kind: 'fatal_error',
      message: 'OTP expired',
      shouldToast: false,
    });

    expect(classifySessionSyncResponse(false, 500, 'bad gateway', null, true)).toEqual({
      kind: 'transient_error',
      message: 'Could not refresh scan session.',
      shouldToast: true,
    });

    expect(classifySessionSyncResponse(true, 200, 'not-an-object', null, false)).toEqual({
      kind: 'invalid_payload',
      message: 'Invalid session response.',
      shouldToast: true,
    });

    expect(
      classifySessionSyncResponse(true, 200, { items: [], status: 'active' }, null, false)
    ).toEqual({
      kind: 'success',
      payload: { items: [], status: 'active' },
    });
  });

  it('resolves submitted scan items from server payloads or local fallbacks', () => {
    expect(
      resolveSubmittedScanItem(
        {
          item: {
            id: 77,
            product_name: 'Sparkling Water',
            upc: '111222333444',
            unit: '  can ',
            scanned_at: '2026-01-02T10:00:00Z',
            quantity: '2',
          },
        },
        'ignored-upc'
      )
    ).toMatchObject({
      id: 77,
      name: 'Sparkling Water',
      upc: '111222333444',
      unit: 'can',
      quantity: 2,
    });

    expect(resolveSubmittedScanItem({}, '012345', '  Manual Name  ', 1234)).toEqual({
      id: 1234,
      name: 'Manual Name',
      upc: '012345',
      unit: '',
      ts: new Date(1234),
      quantity: 1,
    });

    expect(resolveSubmittedScanItem({}, '012345', '   ', 5678)).toEqual({
      id: 5678,
      name: '012345',
      upc: '012345',
      unit: '',
      ts: new Date(5678),
      quantity: 1,
    });
  });

  it('guards scan submission and builds the mobile scan request payload', () => {
    expect(getSubmitScanGuard(undefined, 'active')).toBe('Missing session ID');
    expect(getSubmitScanGuard('session-1', 'draft')).toBe('Scanning is paused for this session.');
    expect(getSubmitScanGuard('session-1', 'active')).toBeNull();

    const deviceSpy = vi
      .spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValue('123e4567-e89b-12d3-a456-426614174999');
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    });

    expect(buildSubmitScanRequest('session-1', 'otp-1', '012345', 'Manual Item')).toEqual({
      url: '/api/session/session-1/scan',
      init: {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Device-Id': '123e4567-e89b-12d3-a456-426614174999',
        },
        body: JSON.stringify({ upc: '012345', otp: 'otp-1', item_name: 'Manual Item' }),
      },
    });
    expect(storage.get('scan_device_id')).toBe('123e4567-e89b-12d3-a456-426614174999');
    expect(deviceSpy).toHaveBeenCalledTimes(1);
  });

  it('evaluates camera idle state, runtime requirements, and lifecycle actions', () => {
    expect(evaluateCameraIdleProgress(0, 10_000)).toEqual({
      hasDeadline: false,
      progress: 1,
      shouldIdle: false,
    });

    expect(evaluateCameraIdleProgress(70_000, 40_000)).toEqual({
      hasDeadline: true,
      progress: 0.5,
      shouldIdle: false,
    });

    expect(evaluateCameraIdleProgress(5_000, 10_000)).toEqual({
      hasDeadline: true,
      progress: 0,
      shouldIdle: true,
    });

    expect(getCameraRuntimeError(true, true)).toBeNull();
    expect(getCameraRuntimeError(false, true)).toBe(
      'Camera requires HTTPS. Open the tunnel URL, not the LAN IP.'
    );
    expect(getCameraRuntimeError(true, false)).toBe(
      'Camera requires HTTPS. Open the tunnel URL, not the LAN IP.'
    );

    expect(getCameraLifecycleAction(false, 'camera', 'active', null)).toBe('idle');
    expect(getCameraLifecycleAction(true, 'camera', 'active', null)).toBe('start');
    expect(getCameraLifecycleAction(true, 'manual', 'active', null)).toBe('stop');
    expect(getCameraLifecycleAction(true, 'camera', 'draft', null)).toBe('stop');
    expect(getCameraLifecycleAction(true, 'camera', 'active', 'Session error')).toBe('stop');

    expect(shouldStopIdleCamera(true, 'camera')).toBe(true);
    expect(shouldStopIdleCamera(false, 'camera')).toBe(false);
    expect(shouldStopIdleCamera(true, 'manual')).toBe(false);
  });

  it('allows manual submission only for non-empty active scans that are not already processing', () => {
    expect(canSubmitManualScan('012345', false, 'active')).toBe(true);
    expect(canSubmitManualScan('   ', false, 'active')).toBe(false);
    expect(canSubmitManualScan('012345', true, 'active')).toBe(false);
    expect(canSubmitManualScan('012345', false, 'draft')).toBe(false);
  });
});

describe('hardware scan helpers', () => {
  it('detects editable targets and ignores non-editable elements', () => {
    class MockElement {
      isContentEditable = false;
      tagName = 'DIV';
    }

    vi.stubGlobal('HTMLElement', MockElement as unknown as typeof HTMLElement);

    const input = new MockElement();
    input.tagName = 'INPUT';

    const editableDiv = new MockElement();
    editableDiv.isContentEditable = true;

    const plainDiv = new MockElement();

    expect(isEditableTarget(input as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(editableDiv as unknown as EventTarget)).toBe(true);
    expect(isEditableTarget(plainDiv as unknown as EventTarget)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('buffers fast hardware keystrokes and submits only complete scans', () => {
    let state = { buffer: '', lastKeyTime: 0 };

    state = reduceHardwareScanKey(state, {
      key: '1',
      now: 100,
      editableTarget: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }).nextState;
    state = reduceHardwareScanKey(state, {
      key: '2',
      now: 150,
      editableTarget: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }).nextState;
    state = reduceHardwareScanKey(state, {
      key: '3',
      now: 200,
      editableTarget: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }).nextState;
    state = reduceHardwareScanKey(state, {
      key: '4',
      now: 250,
      editableTarget: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }).nextState;

    const submit = reduceHardwareScanKey(state, {
      key: 'Enter',
      now: 300,
      editableTarget: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    });

    expect(submit).toEqual({
      nextState: { buffer: '', lastKeyTime: 300 },
      submittedUpc: '1234',
      shouldPreventDefault: true,
    });
  });

  it('resets stale hardware buffers and ignores editable or modified key events', () => {
    const stale = reduceHardwareScanKey(
      { buffer: '1234', lastKeyTime: 100 },
      {
        key: '9',
        now: 181,
        editableTarget: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }
    );
    expect(stale).toEqual({
      nextState: { buffer: '9', lastKeyTime: 181 },
      submittedUpc: null,
      shouldPreventDefault: false,
    });

    const ignoredEditable = reduceHardwareScanKey(
      { buffer: '1234', lastKeyTime: 100 },
      {
        key: 'Enter',
        now: 120,
        editableTarget: true,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }
    );
    expect(ignoredEditable).toEqual({
      nextState: { buffer: '1234', lastKeyTime: 100 },
      submittedUpc: null,
      shouldPreventDefault: false,
    });

    const ignoredModified = reduceHardwareScanKey(
      { buffer: '1234', lastKeyTime: 100 },
      {
        key: 'Enter',
        now: 120,
        editableTarget: false,
        altKey: false,
        ctrlKey: true,
        metaKey: false,
      }
    );
    expect(ignoredModified).toEqual({
      nextState: { buffer: '1234', lastKeyTime: 100 },
      submittedUpc: null,
      shouldPreventDefault: false,
    });

    const ignoredNonPrintable = reduceHardwareScanKey(
      { buffer: '1234', lastKeyTime: 100 },
      {
        key: 'Shift',
        now: 120,
        editableTarget: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
      }
    );
    expect(ignoredNonPrintable).toEqual({
      nextState: { buffer: '1234', lastKeyTime: 120 },
      submittedUpc: null,
      shouldPreventDefault: false,
    });
  });

  it('normalizes stored mode values and only listens when hardware scanning is truly ready', () => {
    expect(readStoredHardwareScanInputMode('hardware')).toBe('hardware');
    expect(readStoredHardwareScanInputMode('mobile')).toBe('mobile');
    expect(readStoredHardwareScanInputMode('unexpected')).toBe('mobile');
    expect(readStoredHardwareScanInputMode(null)).toBe('mobile');

    expect(canSubmitHardwareScan('session-1', 'otp-1', 'active')).toBe(true);
    expect(canSubmitHardwareScan(null, 'otp-1', 'active')).toBe(false);
    expect(canSubmitHardwareScan('session-1', null, 'active')).toBe(false);
    expect(canSubmitHardwareScan('session-1', 'otp-1', 'draft')).toBe(false);

    expect(
      shouldListenForHardwareScanner('hardware', 'session-1', 'otp-1', 'active', 'ready')
    ).toBe(true);
    expect(shouldListenForHardwareScanner('mobile', 'session-1', 'otp-1', 'active', 'ready')).toBe(
      false
    );
    expect(shouldListenForHardwareScanner('hardware', 'session-1', 'otp-1', 'draft', 'ready')).toBe(
      false
    );
    expect(
      shouldListenForHardwareScanner('hardware', 'session-1', 'otp-1', 'active', 'loading')
    ).toBe(false);
  });

  it('builds hardware scan requests and user feedback messages', () => {
    expect(buildHardwareScanRequest('session-42', 'otp-42', '123456789012')).toEqual({
      url: '/api/session/session-42/scan',
      init: {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upc: '123456789012', otp: 'otp-42' }),
      },
    });

    expect(getHardwareScanToast(true, '123456789012')).toEqual({
      type: 'success',
      message: 'Scanned: 123456789012',
    });
    expect(getHardwareScanToast(false, '123456789012')).toEqual({
      type: 'error',
      message: 'Failed to record scan for 123456789012',
    });
  });
});

describe('mobile scanner utilities', () => {
  it('builds helpful camera error messages', () => {
    expect(buildCameraErrorMessage({ name: 'NotAllowedError' })).toMatch(/permission denied/i);
    expect(buildCameraErrorMessage({ name: 'NotFoundError' })).toMatch(/no camera/i);
    expect(buildCameraErrorMessage({ name: 'NotReadableError' })).toMatch(/in use/i);
    expect(buildCameraErrorMessage({ message: 'custom boom' })).toBe('Camera error: custom boom');
    expect(buildCameraErrorMessage({})).toBe('Could not access camera.');
  });

  it('persists a stable device id in local storage', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    });
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '123e4567-e89b-12d3-a456-426614174000'
    );

    expect(getDeviceId()).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(getDeviceId()).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(storage.get('scan_device_id')).toBe('123e4567-e89b-12d3-a456-426614174000');
  });

  it('stops scanner resources and clears the attached video stream', async () => {
    const video = { srcObject: { stream: true } };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.stubGlobal('document', {
      getElementById: (id: string) => (id === 'mobile-reader' ? video : null),
    });

    clearScannerVideo('mobile-reader');
    expect(video.srcObject).toBeNull();

    video.srcObject = { stream: true };

    const controls = {
      stop: vi.fn().mockRejectedValueOnce(new Error('stop failed')),
    };
    const reader = {
      decodeFromConstraints: vi.fn(),
      reset: vi.fn(() => {
        throw new Error('reset failed');
      }),
    };

    await stopScannerResources('mobile-reader', controls, reader);

    expect(controls.stop).toHaveBeenCalledTimes(1);
    expect(reader.reset).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
