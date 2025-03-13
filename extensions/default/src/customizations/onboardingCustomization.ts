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

export default {
  'ohif.tours': [
    {
      id: 'basicViewerTour',
      route: '/viewer',
      steps: [
        {
          id: 'series',
          title: 'Ver otra serie o imagen',
          text: 'De clic aquí para ver otras series o imágenes.',
          attachTo: {
            element: '[data-cy="side-panel-header-left"]',
            on: 'bottom',
          },
          advanceOn: {
            selector: '[data-cy="side-panel-header-left"]',
            event: 'click',
          },
          beforeShowPromise: () => waitForElement('[data-cy="side-panel-header-left"]'),
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
