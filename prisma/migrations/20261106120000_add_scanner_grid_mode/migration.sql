-- Per-scanner grid mode, so 2-grid and 4-grid scanners can run in one session.
-- Same column, type and default as the GraviScan rig build, whose databases
-- already have it: on those, mark this migration applied instead of running it.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GraviScanner" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "display_name" TEXT,
    "vendor_id" TEXT NOT NULL DEFAULT '04b8',
    "product_id" TEXT NOT NULL DEFAULT '013a',
    "usb_port" TEXT,
    "usb_bus" INTEGER,
    "usb_device" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "grid_mode" TEXT NOT NULL DEFAULT '4grid'
);
INSERT INTO "new_GraviScanner" ("createdAt", "display_name", "enabled", "id", "name", "product_id", "updatedAt", "usb_bus", "usb_device", "usb_port", "vendor_id") SELECT "createdAt", "display_name", "enabled", "id", "name", "product_id", "updatedAt", "usb_bus", "usb_device", "usb_port", "vendor_id" FROM "GraviScanner";
DROP TABLE "GraviScanner";
ALTER TABLE "new_GraviScanner" RENAME TO "GraviScanner";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

