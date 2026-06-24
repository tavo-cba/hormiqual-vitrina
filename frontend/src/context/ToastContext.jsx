// ToastContext.jsx
import React, { createContext, useContext } from 'react';
import { toast, Toaster } from 'react-hot-toast';

// Para usar los toast, importamos const toast = useToast();

const ToastContext = createContext(null);

const DEFAULT_DURATION = 4000;

const toastStyles = {
  success: {
    duration: DEFAULT_DURATION,
    className: 'success-toast',
  },
  error: {
    duration: DEFAULT_DURATION,
    className: 'error-toast',
  },
  default: {
    duration: DEFAULT_DURATION,
    className: 'default-toast',
  },
};

export function ToastProvider({ children }) {
  const showToast = (type, message, options = {}) => {
    switch (type) {
      case 'success':
        toast.success(message, {
          ...toastStyles.success,
          ...options,
        });
        break;
      case 'error':
        toast.error(message, {
          ...toastStyles.error,
          ...options,
        });
        break;
      default:
        toast(message, {
          ...toastStyles.default,
          ...options,
        });
        break;
    }
  };

  return (
    <ToastContext.Provider value={showToast}>
      {children}

      <Toaster position="bottom-center" reverseOrder={false} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
