-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GraviImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "graviscan_id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "box_status" TEXT NOT NULL DEFAULT 'pending',
    CONSTRAINT "GraviImage_graviscan_id_fkey" FOREIGN KEY ("graviscan_id") REFERENCES "GraviScan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_GraviImage" ("graviscan_id", "id", "path", "status") SELECT "graviscan_id", "id", "path", "status" FROM "GraviImage";
DROP TABLE "GraviImage";
ALTER TABLE "new_GraviImage" RENAME TO "GraviImage";
CREATE INDEX "GraviImage_graviscan_id_idx" ON "GraviImage"("graviscan_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
