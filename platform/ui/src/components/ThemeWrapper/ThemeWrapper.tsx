import React, { useEffect } from 'react';
import '../../tailwind.css';
import '../../assets/styles/styles.css';

export const ThemeWrapper = ({ children }) => {
  useEffect(() => {
    // Apply dark theme as default
    document.documentElement.classList.add('dark');
  }, []);

  return <React.Fragment>{children}</React.Fragment>;
};

export default ThemeWrapper;
