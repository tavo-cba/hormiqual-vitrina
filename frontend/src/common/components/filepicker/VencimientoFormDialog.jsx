import React, { useEffect, useState } from 'react';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Calendar } from 'primereact/calendar';
import { Button } from 'primereact/button';
import PropTypes from 'prop-types';
import axios from 'axios';
import { config } from '../../../config/config';
import { parseLocalDate } from '../../../common/functions';
import { useToast } from '../../../context/ToastContext';

export default function VencimientoFormDialog({ visible, onHide, file, onSaved }) {
    const [detalle, setDetalle] = useState('');
    const [fecha, setFecha] = useState(null);
    const [saving, setSaving] = useState(false);
    const [suggestLoading, setSuggestLoading] = useState(false);
    const toast = useToast();

    useEffect(() => {
        if (visible && file) {
            setDetalle(file?.vencimientos?.[0]?.detalle || '');
            setFecha(file?.vencimientos?.[0]?.vencimiento ? parseLocalDate(file?.vencimientos?.[0]?.vencimiento) : null);
        }
    }, [visible, file]);


    const save = async () => {
        try {
            setSaving(true);
            const payload = {
                detalle,
                vencimiento: fecha ? fecha.toISOString().slice(0, 10) : null,
                idArchivo: file.idArchivo,
                idEmpleado: file.idEmpleado ?? undefined,
            };
            let res;
            if (file?.vencimientos?.[0]?.idVencimiento) {
                res = await axios.put(
                    `${config.backendUrl}/api/vencimientos/${file?.vencimientos?.[0]?.idVencimiento}`,
                    payload,
                    { headers: config.headers }
                );
            } else {
                res = await axios.post(`${config.backendUrl}/api/vencimientos`, payload, { headers: config.headers });
            }
            onSaved(res.data);
            toast('success', 'Vencimiento guardado');
            onHide();
        } catch (err) {
            console.error(err);
            toast('error', 'Error al guardar');
        } finally {
            setSaving(false);
        }
    };

    const suggest = async () => {
        try {
            setSuggestLoading(true);
            const { data } = await axios.post(
                `${config.backendUrl}/api/vencimientos/sugerir`,
                { imageUrl: file.url },
                { headers: config.headers }
            );
            setDetalle(data.detalle || '');
            setFecha(data.vencimiento ? parseLocalDate(data.vencimiento) : null);
        } catch (err) {
            console.error(err);
            toast('error', 'No se pudo sugerir');
        } finally {
            setSuggestLoading(false);
        }
    };

    return (
        <Dialog
            visible={visible} onHide={onHide} header={<h4 className="m-0">{file?.vencimientos?.[0] ? 'Editar vencimiento' : 'Nuevo vencimiento'}</h4>}
            className="w-11 sm:w-3"
            footer={
                <div className="flex justify-content-end gap-2 ">
                    <Button type="button" label="Completar con IA" rounded icon="fa-solid fa-wand-magic-sparkles" loading={suggestLoading} onClick={suggest} size="small" severity="help" />
                    <Button type="button" label="Guardar" rounded icon="fa-solid fa-check" loading={saving} onClick={save} size="small" />
                </div>
            }
        >
            <div className="flex flex-column gap-3 p-3">
                <InputText value={detalle} onChange={(e) => setDetalle(e.target.value)} placeholder="Detalle" />
                <Calendar value={fecha} onChange={(e) => setFecha(e.value)} dateFormat="dd/mm/yy" placeholder="Fecha" className="w-full" />

            </div>
        </Dialog>
    );
}

VencimientoFormDialog.propTypes = {
    visible: PropTypes.bool.isRequired,
    onHide: PropTypes.func.isRequired,
    file: PropTypes.object,
    onSaved: PropTypes.func.isRequired
};