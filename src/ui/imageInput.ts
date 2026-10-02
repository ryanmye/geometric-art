// The ways a photo can arrive: drag and drop anywhere, the file picker, or paste.

export function setUpImageInput(options: {
  fileInput: HTMLInputElement;
  chooseButtons: HTMLElement[];
  dropOverlay: HTMLElement;
  onFile(file: File): void;
}): void {
  const { fileInput, chooseButtons, dropOverlay, onFile } = options;

  for (const button of chooseButtons) {
    button.addEventListener('click', () => fileInput.click());
  }
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // so choosing the same file again still fires
    if (file) onFile(file);
  });

  // Drag and drop anywhere on the page. dragenter/dragleave fire for every
  // child element, so count them to know when the drag has really left.
  let dragDepth = 0;
  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;

  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth++;
    dropOverlay.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) dropOverlay.hidden = true;
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    dragDepth = 0;
    dropOverlay.hidden = true;
    const file = event.dataTransfer?.files[0];
    if (file) onFile(file);
  });

  // Paste an image (e.g. a screenshot) anywhere except into a text field.
  window.addEventListener('paste', (event) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const items = event.clipboardData?.items ?? [];
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          event.preventDefault();
          onFile(file);
        }
        return;
      }
    }
  });
}
