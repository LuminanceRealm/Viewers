/**
 * Prints an HTML document through a hidden same-origin iframe.
 *
 * An iframe (rather than window.open) avoids popup blockers and keeps the
 * viewer's state untouched. The iframe is positioned off-screen instead of
 * hidden with display:none / visibility:hidden, which would stop it printing.
 */
export default async function openPrintSheet(html: string): Promise<void> {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  // Kept off-screen rather than 1px wide so the document lays out normally
  // before the print stylesheet takes over.
  iframe.style.cssText = 'position:fixed;top:0;left:-10000px;width:800px;height:600px;border:0;';
  document.body.appendChild(iframe);

  const remove = () => {
    if (iframe.parentNode) {
      iframe.remove();
    }
  };

  try {
    const doc = iframe.contentDocument;
    doc.open();
    doc.write(html);
    doc.close();

    const win = iframe.contentWindow;

    await Promise.all(
      Array.from(doc.images).map(
        img =>
          new Promise<void>(resolve => {
            if (img.complete) {
              resolve();
              return;
            }
            img.onload = () => resolve();
            img.onerror = () => resolve();
          })
      )
    );

    win.addEventListener('afterprint', remove, { once: true });
    // Safari never fires afterprint for iframes; clean up on a timer as well.
    setTimeout(remove, 60000);

    win.focus();
    win.print();
  } catch (error) {
    remove();
    throw error;
  }
}
