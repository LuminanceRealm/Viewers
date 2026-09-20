function waitForElement(selector, maxAttempts = 20, interval = 25) {
  return new Promise(resolve => {
    let attempts = 0;

    const checkForElement = setInterval(() => {
      const element = document.querySelector(selector);

      if (element || attempts >= maxAttempts) {
        clearInterval(checkForElement);
        resolve();
      }

      attempts++;
    }, interval);
  });
}

// En teléfono el navegador de series se abre solo cuando hay más de una serie
// (PanelStudyBrowserTracking), así que las miniaturas ya están a la vista y el
// paso guiado sobra: sólo interpone un velo modal sobre la primera interacción.
// En escritorio se conserva.
const isMobile = typeof window !== 'undefined' && window.innerWidth <= 768;

export default {
  'ohif.tours': isMobile
    ? []
    : [
        {
          id: 'basicViewerTour',
          route: '/viewer',
          steps: [
            {
              id: 'series',
              title: 'Ver otra serie o imagen',
              text: 'De clic aquí para ver otras series o imágenes.',
              // Se apunta al botón del propio panel de series y no al encabezado de
              // un lado concreto, que depende de cómo el modo haya acomodado los
              // rieles. Este data-cy existe igual con el panel abierto (la etiqueta
              // "Estudios") y colapsado (el icono del riel).
              attachTo: {
                element: '[data-cy="seriesList-btn"]',
                on: 'bottom',
              },
              advanceOn: {
                selector: '[data-cy="seriesList-btn"]',
                event: 'click',
              },
              beforeShowPromise: () => waitForElement('[data-cy="seriesList-btn"]'),
            },
          ],
          tourOptions: {
            useModalOverlay: true,
            defaultStepOptions: {
              buttons: [
                {
                  text: 'Ignorar',
                  action() {
                    this.complete();
                  },
                  secondary: true,
                },
              ],
            },
          },
        },
      ],
};
