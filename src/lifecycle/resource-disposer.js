const createResourceDisposer = (resources) => {
  if (!Array.isArray(resources) || resources.some(({ dispose }) => typeof dispose !== 'function')) {
    throw new TypeError('Lifecycle resources must provide dispose functions.');
  }

  let isDisposed = false;

  return () => {
    if (isDisposed) {
      return [];
    }

    isDisposed = true;
    const errors = [];

    for (const { label, dispose } of resources) {
      try {
        dispose();
      } catch (error) {
        errors.push({ error, label });
      }
    }

    return errors;
  };
};

module.exports = { createResourceDisposer };
