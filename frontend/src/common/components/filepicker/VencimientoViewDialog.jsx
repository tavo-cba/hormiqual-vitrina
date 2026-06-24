import React from 'react';
import { Dialog } from 'primereact/dialog';
import PropTypes from 'prop-types';
import dayjs from 'dayjs';
import { humanizeDays } from '../../../common/functions';

export default function VencimientoViewDialog({ visible, onHide, vencimiento }) {
    if (!vencimiento) return null;

    const fechaStr = dayjs(vencimiento.vencimiento).format('DD/MM/YYYY'); // <-- string
    const diff = dayjs(vencimiento.vencimiento).diff(dayjs().startOf('day'), 'day');
    const humanized = humanizeDays(diff);

    return (
        <Dialog
            visible={visible}
            onHide={onHide}
            header={
                <div className='flex w-full justify-content-between align-items-start'>
                    <h4 className="m-0">Vencimiento</h4>
                    <h5 className='m-0 mr-2' style={{ color: diff <= 0 ? 'var(--red-200)' : 'var(--green-300)' }}>
                        <i className={diff <= 0 ? 'fa-solid fa-calendar-xmark mr-2' : 'fa-solid fa-check mr-2'}></i>
                        {diff <= 0 ? 'Vencido' : 'Vigente'}
                    </h5>
                </div>
            }
            className="w-11 sm:w-3"
        >
            <div className="flex flex-column align-items-start gap-2 p-3 pt-0">
                <div><strong>Detalle:</strong> {vencimiento?.detalle}</div>
                <div><strong>Vencimiento:</strong> {fechaStr}</div>
                {
                    diff < 0 ?
                        <div className="flex align-items-center font-semibold p-2 br-7" style={{ background: "#fee2e2", color: "#b91c1c" }}> <i className="fa-solid fa-clock mr-2"></i> Vencido hace {humanized}</div>
                        :
                        <div className="flex align-items-center font-semibold p-2 br-7" style={{ background: "#dbeafe", color: "#1d4ed8" }}> <i className="fa-solid fa-clock mr-2"></i> Vence en {humanized}</div>
                }
            </div>
        </Dialog>
    );
}

VencimientoViewDialog.propTypes = {
    visible: PropTypes.bool.isRequired,
    onHide: PropTypes.func.isRequired,
    vencimiento: PropTypes.shape({
        detalle: PropTypes.string,
        vencimiento: PropTypes.string
    })
};
