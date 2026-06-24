import React, { useRef, useState } from 'react';
import { Button } from 'primereact/button';

export default function FileInput({ onSelect, accept = '*/*', label = 'Seleccionar archivo' }) {
    const inputRef = useRef(null);
    const [fileName, setFileName] = useState('');

    const handleChange = (e) => {
        const file = e.target.files?.[0] || null;
        setFileName(file ? file.name : '');
        onSelect?.(file);
    };

    return (
        <div className="flex align-items-center gap-2 flex-column">
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                onChange={handleChange}
                style={{ display: 'none' }}
            />
            <Button type="button" size="small" label={label} icon='fa-solid fa-arrow-up' rounded onClick={() => inputRef.current && inputRef.current.click()} />
            {fileName && <small>{fileName.length > 20 ? `${fileName.slice(0, 20)}...` : fileName}</small>}
        </div>
    );
}