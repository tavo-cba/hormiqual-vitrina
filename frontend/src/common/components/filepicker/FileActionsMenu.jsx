import React, { useRef, useState } from 'react';
import { Menu } from 'primereact/menu';
import { Button } from 'primereact/button';
import PropTypes from 'prop-types';
import VencimientoFormDialog from './VencimientoFormDialog';
import VencimientoViewDialog from './VencimientoViewDialog';

export default function FileActionsMenu({ file, onDelete, onVencimientoUpdated }) {
    const menuRef = useRef(null);
    const [viewVisible, setViewVisible] = useState(false);
    const [formVisible, setFormVisible] = useState(false);
    if (!file) return null;

    const handleDownload = async () => {
        try {
            const response = await fetch(file.url);
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.nombreOriginal || 'archivo';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Error al descargar:', err);
        }
    };

    const items = [
        {
            label: <small>Descargar</small>,
            icon: 'fa-solid fa-download',
            command: handleDownload
        },
        ...(file?.vencimientos?.[0]?.vencimiento
            ? [{ label: <small>Ver vencimiento</small>, icon: 'fa-solid fa-eye', command: () => setViewVisible(true) }]
            : []),
        {
            label: <small>{file?.vencimientos?.[0] ? 'Editar vencimiento' : 'Registrar vencimiento'}</small>,
            icon: 'fa-solid fa-calendar',
            command: () => setFormVisible(true)
        },
        {
            label: <small className='font-semibold' style={{ color: 'var(--red-200)' }}>Borrar</small>,
            icon: <i className='fa-solid fa-trash mr-2' style={{ color: 'var(--red-200)' }}></i>,
            command: onDelete
        }
    ];

    return (
        <>
            <Button icon="fa-solid fa-ellipsis" rounded text onClick={(e) => menuRef.current.toggle(e)} style={{background: 'transparent', border: 'none', outline: 'none'}} />
            <Menu model={items} popup ref={menuRef} />
            <VencimientoViewDialog visible={viewVisible} onHide={() => setViewVisible(false)} vencimiento={file?.vencimientos?.[0] ?? null} />
            <VencimientoFormDialog
                visible={formVisible}
                onHide={() => setFormVisible(false)}
                file={file}
                onSaved={(v) => { onVencimientoUpdated(v); }}
            />
        </>
    );
}

FileActionsMenu.propTypes = {
    file: PropTypes.object.isRequired,
    onDelete: PropTypes.func.isRequired,
    onVencimientoUpdated: PropTypes.func.isRequired
};
