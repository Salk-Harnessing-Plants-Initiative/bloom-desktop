/** Images imported by the renderer: webpack emits the file and gives back its URL. */
declare module '*.png' {
  const url: string;
  export default url;
}
