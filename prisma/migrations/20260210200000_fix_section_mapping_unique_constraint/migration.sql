-- DropIndex
DROP INDEX "GraviPlateSectionMapping_gravi_plate_id_plate_section_id_key";

-- CreateIndex
CREATE UNIQUE INDEX "GraviPlateSectionMapping_gravi_plate_id_plant_qr_key" ON "GraviPlateSectionMapping"("gravi_plate_id", "plant_qr");
