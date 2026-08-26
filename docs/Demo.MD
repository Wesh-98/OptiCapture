# OptiCapture Operating Procedure

Last updated: 2026-08-26

Use this procedure to operate the OptiCapture workflow from login through inventory capture, review, administration, and cleanup checks.

## Preparation

1. Set `ALLOW_DEMO_SEED=true` in the local demo environment.
2. Start the local server.
3. Use `npm run dev:scan` when a real phone must scan from outside localhost.
4. Open the desktop browser at `https://localhost:3000`.
5. Open the phone browser with the QR/tunnel URL and verify camera permission.
6. Confirm that at least one category exists.
7. Confirm that several inventory items exist.
8. Confirm that Logs contains recent activity from an import, item edit, or scan.
9. For multi-store testing, confirm that the user has access to more than one active store.
10. For Google OAuth testing, confirm that `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the callback URL are configured.

## 1. Login

1. Open `/login`.
2. Confirm the login form includes store code, username, password, and optional Google sign-in.
3. Enter owner or taker credentials with a valid store code.
4. Submit the form.
5. Confirm that the user lands in the app or the store selection screen.
6. For superadmin testing, sign out and sign in with a superadmin account without entering a store code.
7. Do not trigger account lockout unless lockout behavior is the specific item being verified.

Expected result:

- Owner and taker users authenticate with store code credentials.
- Superadmin users authenticate without a store code.
- Failed-login lockout remains available for security verification.

## 2. Store Selection

Use this section only for users with access to multiple active stores.

1. Sign in as a multi-store user.
2. Confirm the app routes to `/choose-store`.
3. Select an active store.
4. Confirm the dashboard opens for the selected store.
5. Change stores from the app shell if available.
6. Confirm store-scoped scan session state is cleared after changing stores.
7. Sign in as a single-store user.
8. Confirm the store selection screen is skipped.

Expected result:

- Multi-store users choose the working store for the current tab.
- Single-store users enter the app directly.
- Store changes do not carry scan sessions across stores.

## 3. Dashboard

1. Open the dashboard at `/`.
2. Confirm the stats bar displays total categories, total items, in-stock count, and out-of-stock count.
3. Open the active/draft sessions panel.
4. Confirm active or draft sessions are listed when available.
5. Review the category grid.
6. Open a category and confirm its items are listed.
7. Use global search to search by item name.
8. Use global search to search by UPC.
9. Use global search to search by category.
10. Add a new item with name, UPC, quantity, price, and category.
11. Confirm the new item appears in the item list.
12. Edit the item through the edit modal.
13. Confirm the edited values are saved.
14. Delete an item and complete the two-step confirmation.
15. Change pagination between 50, 100, and 200 items.
16. Open the export modal from the sidebar or dashboard export action.

Expected result:

- Dashboard totals, search, category navigation, item CRUD, pagination, active sessions, and export access work for the current store.
- Owner-only dashboard actions are available to owners.
- Taker access is limited according to role permissions.

## 4. Mobile Barcode Scanning

1. Open `/scan` on the desktop.
2. Confirm a scan session is created.
3. Confirm the QR code is visible.
4. Confirm the OTP is visible under the QR code.
5. Scan the QR code with the phone.
6. Confirm the phone opens `/mobile-scan/:sessionId`.
7. Allow camera access on the phone.
8. Scan a product barcode.
9. Confirm the scanned item appears on the phone.
10. Confirm the scanned item appears in the desktop feed.
11. Switch the phone to manual entry.
12. Submit a manual UPC or item name.
13. Confirm the manual entry appears in the desktop feed.
14. Edit a staged item from the desktop if needed.
15. Delete a staged item from the desktop if needed.
16. Select items for commit.
17. Commit selected items when ready.

Expected result:

- The phone joins by session ID and OTP.
- Camera scanning works when browser security requirements are met.
- Manual entry works as a fallback.
- Desktop and phone views reflect the same session state.
- Selected staged items can be committed into inventory.

## 5. Hardware Barcode Scanning

1. Open `/scan` on the desktop.
2. Switch to hardware scanner mode.
3. Connect a USB or Bluetooth barcode scanner.
4. Scan a barcode.
5. If no scanner is available, type a barcode quickly and press Enter.
6. Confirm the item appears in the desktop feed.
7. Confirm the item follows the same review and commit flow as mobile scans.

Expected result:

- Hardware scanner input is captured through keyboard-wedge behavior.
- Hardware and mobile scan items enter the same scan session workflow.

## 6. Draft Sessions

1. Start or resume a scan session with at least one staged item.
2. Save the session as a named draft.
3. Return to the dashboard.
4. Open the active/draft sessions panel.
5. Confirm the draft appears with its label.
6. Resume the draft.
7. Confirm staged items are still present.
8. Clear all staged items if that behavior needs verification.
9. Delete the draft if that behavior needs verification.
10. Commit the draft when review is complete.
11. Attempt to reopen or delete a completed session only if verifying completed-session protection.

Expected result:

- Draft sessions can be named, paused, resumed, cleared, deleted, or committed.
- Completed sessions cannot be reactivated.

## 7. Bulk Import

1. Open `/import`.
2. Upload a prepared Excel, CSV, or JSON file.
3. Confirm the file is parsed.
4. Review detected sheets, headers, preview rows, and row counts.
5. Review the automatic column mappings.
6. Adjust mappings as needed.
7. Map external identifiers when the integration workflow is being tested.
8. Confirm the import.
9. Review the import result: added rows, updated rows, skipped rows, and errors.
10. Return to the dashboard.
11. Confirm imported categories and items are visible.

Expected result:

- Supported file formats parse successfully.
- Column mappings can be reviewed and adjusted.
- Missing categories are created when needed.
- External identifier fields are preserved when mapped.

## 8. Activity Logs

1. Open `/logs`.
2. Confirm recent actions from the demo are present.
3. Filter by action type.
4. Filter by date range.
5. Search log details if needed.
6. Change page size if needed.

Expected result:

- Store-scoped activity is visible to authorized users.
- Inventory changes, imports, exports, sign-ins, and scan actions appear in the audit trail.

## 9. Store Settings

1. Open `/settings`.
2. Review store name.
3. Review address fields.
4. Review phone and email fields.
5. Review store logo.
6. Reveal and copy the store code.
7. Update store profile fields as an owner.
8. Save changes.
9. Confirm changes persist after refresh.
10. Open the password change section.
11. Change the current user's password only in a disposable local account.
12. Sign in as a taker if role differences need verification.
13. Confirm store profile fields are read-only for takers.

Expected result:

- Owners can update store identity fields.
- Store code reveal/copy works.
- All roles can access password change.
- Takers cannot edit store profile fields.

## 10. Superadmin Panel

1. Sign in as a superadmin.
2. Open `/admin`.
3. Review the store list.
4. Confirm user and item counts appear.
5. Filter stores by status.
6. Search stores.
7. Sort stores if needed.
8. Edit store details.
9. Suspend a store.
10. Confirm suspended store behavior if needed.
11. Reactivate the store.
12. Open user management for a store.
13. Add access for an existing user if test data is available.
14. Create a new store user.
15. Record the one-time temporary password only for the active demo flow.
16. Confirm the new user must reset the temporary password.
17. Reset an existing user's password.
18. Confirm the forced reset flow.

Expected result:

- Superadmin users can manage stores, status, store users, and password recovery workflows.
- HQ/internal store records are not modified during normal store administration.

## Wrap-Up Verification

1. Confirm the dashboard reflects committed inventory changes.
2. Confirm the scan session is completed, drafted, or deleted as intended.
3. Confirm recent activity appears in Logs.
4. Confirm no real `.env` values were displayed.
5. Confirm no local database files or uploaded customer files were displayed.
6. Confirm temporary passwords are no longer visible.

## Operating Cautions

- Do not show real `.env` values.
- Do not show local database files or uploaded customer files.
- Do not rely on cellular scanning unless the tunnel has already been verified.
- Do not test Google OAuth unless the configured callback URL matches the environment.
- Do not leave temporary passwords visible after recovery verification.
