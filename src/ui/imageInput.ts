// The ways photos can arrive: drag and drop anywhere, the file picker, or
// paste. Each can bring several files at once; they are passed on together.

export function setUpImageInput(options: {
  fileInput: HTMLInputElement;
  chooseButtons: HTMLElement[];
  dropOverlay: HTMLElement;
  onFiles(files: File[]): void;
}): void {
  const { fileInput, chooseButtons, dropOverlay, onFiles } = options;

  for (const button of chooseButtons) {
    button.addEventListener('click', () => fileInput.click());
  }
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = ''; // so choosing the same files again still fires
    if (files.length > 0) onFiles(files);
  });

  // Drag and drop anywhere on the page. dragenter/dragleave fire for every
  // child element, so count them to know when the drag has really left.
  // Drags that carry no files (a link, text, an image from another page) are
  // refused, so the browser does not open them in a new tab, except over a
  // text field, where dropping text is normal.
  let dragDepth = 0;
  let overlayTimer = 0;
  const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
  const overTextField = (event: Event) => {
    const target = event.target as HTMLElement | null;
    return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || (target?.isContentEditable ?? false);
  };

  function showOverlay(): void {
    dropOverlay.hidden = false;
    // If a drag ends without any event reaching the page (it can happen when
    // a drag is cancelled), hide the overlay once dragover stops arriving
    // (browsers send it several times a second while a drag is over the page).
    clearTimeout(overlayTimer);
    overlayTimer = window.setTimeout(hideOverlay, 1500);
  }
  function hideOverlay(): void {
    clearTimeout(overlayTimer);
    dragDepth = 0;
    dropOverlay.hidden = true;
  }

  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) {
      if (!overTextField(event)) event.preventDefault();
      return;
    }
    event.preventDefault();
    dragDepth++;
    showOverlay();
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) {
      if (overTextField(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    showOverlay();
  });
  window.addEventListener('dragleave', (event) => {
    if (!hasFiles(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    // Leaving the window: no element to go to, or the pointer outside it.
    const left =
      event.relatedTarget === null &&
      (event.clientX <= 0 || event.clientY <= 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight);
    if (dragDepth === 0 || left) hideOverlay();
  });
  window.addEventListener('dragend', hideOverlay);
  window.addEventListener('drop', (event) => {
    hideOverlay();
    if (!hasFiles(event)) {
      if (!overTextField(event)) event.preventDefault();
      return;
    }
    event.preventDefault();
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) onFiles(files);
  });

  // Paste images (e.g. a screenshot) anywhere except into a text field.
  window.addEventListener('paste', (event) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const files: File[] = [];
    for (const item of Array.from(event.clipboardData?.items ?? [])) {
      if (item.kind !== 'file') continue;
      const file = item.getAsFile();
      // Images, and HEIC photos, which some browsers give no type at all.
      if (file && (file.type.startsWith('image/') || file.type === '' || /\.(heic|heif)$/i.test(file.name))) files.push(file);
    }
    if (files.length > 0) {
      event.preventDefault();
      onFiles(files);
    }
  });
}
