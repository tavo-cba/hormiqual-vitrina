import React from 'react';

const CellFade = ({ children, uniqueKey }) => {
  return (
    <span key={uniqueKey} className="cell-fade">
      {children}
    </span>
  );
};

export default CellFade;
