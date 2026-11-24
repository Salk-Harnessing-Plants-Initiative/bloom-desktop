/** An accession file with plants whose barcode or accession name matched a search. */
export interface AccessionFileMatch {
  accession_file_id: string;
  /** How many of the file's plants matched. */
  matching_plants: number;
}
