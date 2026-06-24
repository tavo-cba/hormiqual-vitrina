import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import { FileUpload } from 'primereact/fileupload';
import { Button } from 'primereact/button';
import { useToast } from '../../../context/ToastContext';
import { config } from '../../../config/config';
import './filepicker.css';
import { Accordion, AccordionTab } from 'primereact/accordion';
import { Divider } from 'primereact/divider';
import FileActionsMenu from './FileActionsMenu';
import { confirmDialog } from 'primereact/confirmdialog';
import LoadSpinner from '../loadspinner/LoadSpinner';

/**
 * FilePicker
 * ----------
 * Componente reutilizable para manejar archivos y categorías.
 *
 * Props
 *  - archivos: array con los archivos existentes
 *  - setArchivos: función para actualizar lista de archivos
 *  - tipo: número de tipo de categoría (default 0)
 */
export default function FilePicker({
    archivos = [],
    setArchivos,
    tipo = 0,
    extraFields = {},
    categorias: categoriasProp,
    setCategorias: setCategoriasProp
}) {
    const toast = useToast();
    const [categoriasState, setCategoriasState] = useState([]);
    const categorias = categoriasProp ?? categoriasState;
    const setCategorias = setCategoriasProp ?? setCategoriasState;
    const [uploading, setUploading] = useState(false);
    const [dragFile, setDragFile] = useState(null); // contiene el archivo en arrastre
    const [dragPos, setDragPos] = useState({ x: 0, y: 0 });
    const [hoverCat, setHoverCat] = useState(null);
    const [moveLoading, setMoveLoading] = useState(false);

    // Track cursor position via document dragover (much more accurate than onDrag)
    useEffect(() => {
        if (!dragFile) return;
        const handleDragOver = (e) => {
            setDragPos({ x: e.clientX, y: e.clientY });
        };
        document.addEventListener('dragover', handleDragOver);
        return () => document.removeEventListener('dragover', handleDragOver);
    }, [dragFile]);

    // ----- cargar categorías -----
    useEffect(() => {
        if (categoriasProp) return;
        const load = async () => {
            try {
                const { data } = await axios.get(
                    `${config.backendUrl}/api/archivos/categorias`,
                    { headers: config.headers }
                );
                setCategorias(data.filter(c => c.tipo === tipo));
            } catch (err) {
                console.error(err);
            }
        };
        load();
    }, [tipo, categoriasProp]);


    // ----- subir archivos -----
    const uploadHandler = async (event) => {
        if (!event.files.length) return;
        try {
            setUploading(true);
            const fd = new FormData();
            event.files.forEach(f => fd.append('files', f));
            fd.append('tipo', tipo);
            Object.entries(extraFields).forEach(([k, v]) => fd.append(k, v));
            const { data } = await axios.post(
                `${config.backendUrl}/api/archivos`,
                fd,
                { headers: { ...config.headers, 'Content-Type': 'multipart/form-data' } }
            );
            setArchivos(prev => [...prev, ...(Array.isArray(data) ? data : [data])]);
            event.options.clear();
            toast('success', 'Archivo(s) subido(s)');
        } catch (err) {
            console.error(err);
            toast('error', 'Error al subir');
        } finally {
            setUploading(false);
        }
    };
    const confirmarBorrado = (id) => {
        confirmDialog({
            message: "¿Estás seguro que deseas borrar este archivo?",
            header: "Confirmar",
            icon: "fa-solid fa-triangle-exclamation",
            acceptLabel: 'Borrar',
            acceptIcon: 'fa-solid fa-trash',
            acceptClassName: 'border-round-3xl',
            rejectLabel: 'Cancelar',
            accept: () => handleDeleteFile(id),
        });
    };
    const handleDeleteFile = async (id) => {
        try {
            await axios.delete(`${config.backendUrl}/api/archivos/${id}`, {
                headers: config.headers,
            });
            setArchivos(prev => prev.filter(a => a.idArchivo !== id));
            toast('success', 'Archivo eliminado');
        } catch (err) {
            console.error(err);
            toast('error', 'No se pudo eliminar');
        }
    };

    const handleVencimientoUpdate = (idArchivo, vencimiento) => {
        setArchivos(prev =>
            prev.map(a =>
                a.idArchivo === idArchivo ? { ...a, vencimientos: [vencimiento] } : a
            )
        );
    };
    const moveFile = async (fileId, catId) => {
        try {
            setArchivos(prev =>
                prev.map(a =>
                    a.idArchivo === fileId ? { ...a, moveLoading: true } : a
                )
            );
            const data = await axios.put(
                `${config.backendUrl}/api/archivos/${fileId}`,
                { idCategoriaArchivo: catId },
                { headers: config.headers }
            );

            setArchivos(prev =>
                prev.map(a =>
                    a.idArchivo === fileId ? { ...a, idCategoriaArchivo: catId } : a
                )
            );
            toast('success', 'Archivo movido');
        } catch (err) {
            console.error(err);
            toast('error', 'No se pudo mover');
        } finally {
            setArchivos(prev =>
                prev.map(a =>
                    a.idArchivo === fileId ? { ...a, moveLoading: false } : a
                )
            );
        }
    };

    const onDropCategoria = (e, catId) => {
        e.preventDefault();
        if (!dragFile) return;
        moveFile(dragFile.idArchivo, catId);
        setDragFile(null);
        setHoverCat(null);
    };

    return (
        <div className="file-picker flex gap-3 flex-column w-full">
            <div className="flex flex-column xl:flex-row categories filepicker-accordion gap-4">
                <div className='w-full xl:w-6 flex flex-column pb-2 xl:pb-6'>
                    <h3 className='m-0 pb-3'><i className='fa-solid fa-folder-tree mr-2'></i>Categorías de archivos</h3>
                    <Accordion className='flex flex-column w-full gap-2'>
                        {categorias.map(cat => (
                            <AccordionTab
                                key={cat.idCategoriaArchivo}
                                headerClassName={`${hoverCat === cat.idCategoriaArchivo && dragFile ? 'cat-hover' : ''}`}
                                header={
                                    <div
                                        className={`flex w-full align-items-center justify-content-between gap-2`}
                                        onDragOver={e => { e.preventDefault(); setHoverCat(cat.idCategoriaArchivo); }}
                                        onDragEnter={e => { e.preventDefault(); setHoverCat(cat.idCategoriaArchivo); }}
                                        onDragLeave={e => { e.preventDefault(); setHoverCat(null); }}
                                        onDrop={e => onDropCategoria(e, cat.idCategoriaArchivo)}
                                    >
                                        <span className='w-10 font-medium'><i className='fa-solid fa-folder-open mr-2'></i>{cat.categoria}</span>
                                        <span className='filepicker-file-count'><i className='fa-solid fa-file mr-1' style={{ fontSize: '0.7rem' }}></i>{archivos.filter(a => a.idCategoriaArchivo == cat.idCategoriaArchivo).length}</span>
                                    </div>
                                }
                            >
                                {
                                    archivos.filter(a => a.idCategoriaArchivo == cat.idCategoriaArchivo).length ?
                                        null
                                        :
                                        <h4 className='m-0 p-3'><i className='fa-solid fa-file-circle-xmark mr-2' style={{ color: 'var(--red-300)' }}></i>No hay archivos en esta categoría</h4>
                                }
                                {archivos.filter(a => a.idCategoriaArchivo == cat.idCategoriaArchivo).map(a => (
                                    <div
                                        key={a.idArchivo}
                                        className="file-item"
                                        draggable
                                        onDragStart={(e) => {
                                            setDragPos({ x: e.clientX, y: e.clientY });
                                            setDragFile(a);
                                            const img = new Image();
                                            img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2kFyoAAAAASUVORK5CYII=';
                                            e.dataTransfer.setDragImage(img, 0, 0);
                                        }}
                                        onDragEnd={() => setDragFile(null)}
                                    >
                                        <div className="flex align-items-center gap-2 flex-1">
                                            {a.moveLoading ?
                                                <LoadSpinner size={28} />
                                                :
                                                a.mimeType.startsWith('image/') ? (
                                                    <i className="fa-solid fa-image" style={{ fontSize: '1.2rem' }} />
                                                ) : (
                                                    <i className="fa-solid fa-file-lines" style={{ fontSize: '1.2rem' }} />
                                                )}
                                            <a href={a.url} target="_blank" rel="noreferrer" className="text-primary">
                                                <small>{a.nombreOriginal}</small>
                                            </a>
                                        </div>
                                        <FileActionsMenu
                                            file={a}
                                            onDelete={() => confirmarBorrado(a.idArchivo)}
                                            onVencimientoUpdated={(v) => handleVencimientoUpdate(a.idArchivo, v)}
                                        />
                                    </div>
                                ))}
                            </AccordionTab>
                        ))}
                    </Accordion>
                </div>
                <div className='w-full xl:w-6 flex flex-column'>
                    <h3 className='m-0 pb-3'><i className='fa-solid fa-file mr-2'></i>Archivos sin categoría</h3>
                    <Accordion>

                        <AccordionTab
                            key={'sincat'}
                            className='sin-cat'
                            header={
                                <div
                                    className={`flex align-items-center justify-content-between gap-2`}
                                >
                                    <span>
                                        <i className='fa-solid fa-folder-open mr-2'></i>
                                        {
                                            archivos.filter(a => !a.idCategoriaArchivo).length ?
                                                `Ver ${archivos.filter(a => !a.idCategoriaArchivo).length} archivo${archivos.filter(a => !a.idCategoriaArchivo).length == 1 ? '' : 's'} sin categoría`
                                                :
                                                'No hay archivos sin categoría'
                                        }
                                    </span>
                                </div>
                            }
                        >


                            {archivos.filter(a => !a.idCategoriaArchivo).length > 0 ?

                                <div className=''>

                                    {archivos.filter(a => !a.idCategoriaArchivo).map(a => (
                                        <div
                                            key={a.idArchivo}
                                            className="file-item nocat"
                                            draggable
                                            onDragStart={(e) => {
                                                setDragFile(a);
                                                const img = new Image();
                                                img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO2kFyoAAAAASUVORK5CYII=';
                                                e.dataTransfer.setDragImage(img, 0, 0);
                                            }}
                                            onDragEnd={() => setDragFile(null)}
                                        >
                                            <div className="flex align-items-center gap-2">
                                                {a.moveLoading ?
                                                    <LoadSpinner size={28} />
                                                    :
                                                    a.mimeType.startsWith('image/') ? (
                                                        <i className="fa-solid fa-image" style={{ fontSize: '1.2rem' }} />
                                                    ) : (
                                                        <i className="fa-solid fa-file-lines" style={{ fontSize: '1.2rem' }} />
                                                    )}
                                                <a href={a.url} target="_blank" rel="noreferrer" className="text-primary">
                                                    <small>{a.nombreOriginal}</small>
                                                </a>
                                            </div>
                                            <FileActionsMenu
                                                file={a}
                                                onDelete={() => confirmarBorrado(a.idArchivo)}
                                                onVencimientoUpdated={(v) => handleVencimientoUpdate(a.idArchivo, v)}
                                            />
                                        </div>
                                    ))}
                                </div>
                                :
                                null
                            }
                        </AccordionTab>
                    </Accordion>
                    <div className='w-full py-4'>

                        <div className="files flex-1">
                            <FileUpload
                                name="files"
                                customUpload
                                uploadHandler={uploadHandler}
                                multiple
                                accept="application/pdf,image/*"
                                className='filepicker-upload'
                                maxFileSize={18 * 1024 * 1024}
                                chooseLabel="Seleccionar"
                                uploadLabel={uploading ? 'Subiendo' : 'Subir'}
                                emptyTemplate={<h3 className='text-center'>No hay archivos pendientes para subir</h3>}
                                cancelOptions={{ style: { display: 'none' } }}
                                uploadOptions={{ className: uploading ? 'p-disabled' : '' }}
                            />

                        </div>
                        {dragFile && dragPos.x > 0 && dragPos.y > 0 && createPortal(
                            <div className="drag-ghost" style={{ top: dragPos.y + 12, left: dragPos.x + 12 }}>
                                <div className="flex align-items-center gap-2">
                                    {dragFile.mimeType.startsWith('image/') ? (
                                        <i className="fa-solid fa-image" style={{ fontSize: '1rem' }} />
                                    ) : (
                                        <i className="fa-solid fa-file-lines" style={{ fontSize: '1rem' }} />
                                    )}
                                    <span style={{ fontSize: '0.85rem' }}>{dragFile.nombreOriginal}</span>
                                </div>
                            </div>,
                            document.body
                        )}
                    </div>
                </div>

            </div>
        </div>
    )
}