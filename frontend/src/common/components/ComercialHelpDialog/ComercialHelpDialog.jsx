import React, { useState } from 'react';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import './comercialHelpDialog.css';

/**
 * ComercialHelpDialog - Componente reutilizable de ayuda para el módulo Comercial.
 * Incluye el botón (?) y el Dialog completo con toda la documentación.
 *
 * Se usa en ordenVenta.jsx y ordenCompra.jsx envolviendo el PageHeader
 * en un div con position: relative.
 */
const ComercialHelpDialog = () => {
    const [visible, setVisible] = useState(false);

    return (
        <>
            <Button
                icon="fa-solid fa-circle-question"
                rounded
                text
                className="comercial-help-btn"
                onClick={() => setVisible(true)}
                tooltip="Ayuda del módulo Comercial"
                tooltipOptions={{ position: 'left' }}
            />

            <Dialog
                header="Guía del Módulo Comercial"
                visible={visible}
                onHide={() => setVisible(false)}
                style={{ width: '90vw', maxWidth: '800px' }}
                maximizable
                dismissableMask
            >
                <div className="comercial-help-content">

                    {/* ========== OBJETIVO ========== */}
                    <div className="comercial-help-section">
                        <h3><i className="fa-solid fa-bullseye mr-2" style={{ color: '#42A5F5' }} />Objetivo del Módulo</h3>
                        <p>
                            El módulo Comercial es el corazón administrativo de la empresa. Gestiona el ciclo completo de
                            <strong> ventas</strong> (desde la orden hasta el cobro) y de <strong>compras</strong> (desde la orden
                            al proveedor hasta el pago), incluyendo facturación electrónica, tesorería, cuentas corrientes
                            e impuestos. Todo queda registrado para mantener un control financiero preciso.
                        </p>
                    </div>

                    {/* ========== PRIMEROS PASOS ========== */}
                    <div className="comercial-help-section comercial-help-getting-started">
                        <h3><i className="fa-solid fa-rocket mr-2" style={{ color: '#4CAF50' }} />Primeros Pasos</h3>
                        <p>Si sos nuevo en el sistema, seguí estos pasos para arrancar:</p>
                        <ol className="comercial-help-steps-numbered">
                            <li><strong>Cargá los Productos/Servicios</strong> que la empresa vende, con sus precios e IVA correspondiente.</li>
                            <li><strong>Cargá los Clientes</strong> con CUIT, dirección fiscal y condición de IVA (desde el módulo de Clientes).</li>
                            <li><strong>Cargá los Proveedores</strong> con CUIT y datos fiscales (desde el módulo de Proveedores).</li>
                            <li><strong>Configurá las Cajas y Bancos</strong> donde se registrarán los movimientos de dinero.</li>
                            <li><strong>Creá tu primera Orden de Venta</strong> seleccionando un cliente y agregando productos/servicios.</li>
                            <li><strong>Generá el Remito</strong> cuando entregues la mercadería.</li>
                            <li><strong>Emití la Factura Electrónica</strong> desde la orden de venta o directamente.</li>
                            <li><strong>Registrá la Cobranza</strong> cuando el cliente pague.</li>
                            <li>Para compras: <strong>Cargá la Orden de Compra</strong>, luego la factura del proveedor y finalmente el pago.</li>
                            <li><strong>Revisá las Cuentas Corrientes</strong> para verificar saldos de clientes y proveedores.</li>
                        </ol>
                    </div>

                    {/* ========== FLUJO DE VENTAS ========== */}
                    <div className="comercial-help-section">
                        <h3><i className="fa-solid fa-arrow-right-arrow-left mr-2" style={{ color: '#66BB6A' }} />Flujo de Ventas</h3>
                        <p>El ciclo comercial de ventas sigue estos pasos:</p>
                        <div className="comercial-help-flow">
                            <div className="comercial-help-flow-step">
                                <div className="comercial-help-flow-icon" style={{ background: 'linear-gradient(135deg, #42A5F5, #1E88E5)' }}>
                                    <i className="fa-solid fa-clipboard-list" />
                                </div>
                                <strong>Orden de Venta</strong>
                                <small>Pedido del cliente</small>
                            </div>
                            <i className="fa-solid fa-chevron-right comercial-help-flow-arrow" />
                            <div className="comercial-help-flow-step">
                                <div className="comercial-help-flow-icon" style={{ background: 'linear-gradient(135deg, #26C6DA, #00ACC1)' }}>
                                    <i className="fa-solid fa-truck" />
                                </div>
                                <strong>Remito</strong>
                                <small>Entrega</small>
                            </div>
                            <i className="fa-solid fa-chevron-right comercial-help-flow-arrow" />
                            <div className="comercial-help-flow-step">
                                <div className="comercial-help-flow-icon" style={{ background: 'linear-gradient(135deg, #66BB6A, #43A047)' }}>
                                    <i className="fa-solid fa-file-invoice-dollar" />
                                </div>
                                <strong>Factura</strong>
                                <small>Comprobante fiscal</small>
                            </div>
                            <i className="fa-solid fa-chevron-right comercial-help-flow-arrow" />
                            <div className="comercial-help-flow-step">
                                <div className="comercial-help-flow-icon" style={{ background: 'linear-gradient(135deg, #FFA726, #FB8C00)' }}>
                                    <i className="fa-solid fa-hand-holding-dollar" />
                                </div>
                                <strong>Cobranza</strong>
                                <small>Cobro al cliente</small>
                            </div>
                            <i className="fa-solid fa-chevron-right comercial-help-flow-arrow" />
                            <div className="comercial-help-flow-step">
                                <div className="comercial-help-flow-icon" style={{ background: 'linear-gradient(135deg, #AB47BC, #8E24AA)' }}>
                                    <i className="fa-solid fa-scale-balanced" />
                                </div>
                                <strong>Cta. Corriente</strong>
                                <small>Saldo del cliente</small>
                            </div>
                        </div>
                    </div>

                    {/* ========== FLUJO DE COMPRAS ========== */}
                    <div className="comercial-help-section">
                        <h3><i className="fa-solid fa-arrow-right-arrow-left mr-2" style={{ color: '#EF5350' }} />Flujo de Compras</h3>
                        <p>El ciclo comercial de compras sigue estos pasos:</p>
                        <div className="comercial-help-flow">
                            <div className="comercial-help-flow-step">
                                <div className="comercial-help-flow-icon" style={{ background: 'linear-gradient(135deg, #EF5350, #E53935)' }}>
                                    <i className="fa-solid fa-file-invoice-dollar" />
                                </div>
                                <strong>Orden de Compra</strong>
                                <small>Pedido al proveedor</small>
                            </div>
                            <i className="fa-solid fa-chevron-right comercial-help-flow-arrow" />
                            <div className="comercial-help-flow-step">
                                <div className="comercial-help-flow-icon" style={{ background: 'linear-gradient(135deg, #FF7043, #F4511E)' }}>
                                    <i className="fa-solid fa-file-lines" />
                                </div>
                                <strong>Factura Compra</strong>
                                <small>Del proveedor</small>
                            </div>
                            <i className="fa-solid fa-chevron-right comercial-help-flow-arrow" />
                            <div className="comercial-help-flow-step">
                                <div className="comercial-help-flow-icon" style={{ background: 'linear-gradient(135deg, #FFA726, #FB8C00)' }}>
                                    <i className="fa-solid fa-money-bill-transfer" />
                                </div>
                                <strong>Pago</strong>
                                <small>Al proveedor</small>
                            </div>
                            <i className="fa-solid fa-chevron-right comercial-help-flow-arrow" />
                            <div className="comercial-help-flow-step">
                                <div className="comercial-help-flow-icon" style={{ background: 'linear-gradient(135deg, #78909C, #546E7A)' }}>
                                    <i className="fa-solid fa-scale-balanced" />
                                </div>
                                <strong>Cta. Corriente</strong>
                                <small>Saldo proveedor</small>
                            </div>
                        </div>
                    </div>

                    {/* ========== MÓDULO VENTAS ========== */}
                    <div className="comercial-help-section">
                        <div className="comercial-help-group-header">
                            <i className="fa-solid fa-cart-shopping" style={{ color: '#66BB6A' }} />
                            <h3>Módulo de Ventas</h3>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-box" style={{ color: '#42A5F5' }} />Productos y Servicios</h4>
                            <p>
                                Catálogo maestro de todo lo que la empresa vende. Cada producto tiene nombre, descripción,
                                precio unitario, alícuota de IVA y unidad de medida. Este catálogo se usa al crear órdenes
                                de venta y facturas para seleccionar los ítems rápidamente.
                            </p>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-clipboard-list" style={{ color: '#1E88E5' }} />Órdenes de Venta</h4>
                            <p>
                                Registran el pedido del cliente antes de facturar. Se selecciona el cliente, se agregan los
                                productos/servicios con cantidades y precios, y el sistema calcula subtotales, impuestos y total.
                                Los estados posibles son: <strong>Borrador</strong> (editable), <strong>Confirmada</strong> (lista para
                                facturar/entregar), <strong>Facturada</strong> (ya tiene factura asociada) y <strong>Anulada</strong>.
                                Desde la orden podés generar remitos, facturas y ver el seguimiento de facturación y cobranza.
                            </p>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-truck" style={{ color: '#26C6DA' }} />Remitos de Venta</h4>
                            <p>
                                Comprueban la entrega de mercadería al cliente. Se generan a partir de una orden de venta
                                o de forma independiente. Detallan qué productos se entregaron, en qué cantidad y fecha.
                                Sirven como respaldo logístico de que el cliente recibió lo solicitado.
                            </p>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-cloud-arrow-up" style={{ color: '#5C6BC0' }} />Remitos Electrónicos</h4>
                            <p>
                                Versión digital de los remitos integrada con los servicios de AFIP/ARCA. Permite generar
                                remitos electrónicos con código de autorización, cumpliendo con la normativa fiscal vigente
                                para el traslado de mercaderías.
                            </p>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-file-invoice-dollar" style={{ color: '#43A047' }} />Facturas de Venta</h4>
                            <p>
                                Comprobantes fiscales electrónicos emitidos al cliente. Se pueden generar desde una orden de venta
                                (pre-cargando datos) o de forma directa. Incluyen Factura A, B, C, Nota de Crédito y Nota de Débito,
                                todas validadas contra AFIP/ARCA. El sistema calcula automáticamente IVA, percepciones y totales.
                                Una vez emitida, la factura impacta en la cuenta corriente del cliente.
                            </p>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-hand-holding-dollar" style={{ color: '#FB8C00' }} />Cobranzas</h4>
                            <p>
                                Registran los cobros recibidos de los clientes. Se asocian a facturas pendientes de cobro y
                                se indica el medio de pago (efectivo, cheque, transferencia, etc.), el monto y la fecha.
                                Al registrar una cobranza, se actualiza automáticamente el saldo en la cuenta corriente del
                                cliente y los movimientos de caja o banco según corresponda.
                            </p>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-scale-balanced" style={{ color: '#AB47BC' }} />Cuenta Corriente Cliente</h4>
                            <p>
                                Muestra el estado de cuenta de cada cliente: facturas emitidas, notas de crédito, cobranzas
                                recibidas y el saldo pendiente. Permite ver el historial completo de movimientos y filtrar
                                por período. Es fundamental para el seguimiento de deudas y la gestión de créditos.
                            </p>
                        </div>
                    </div>

                    {/* ========== MÓDULO COMPRAS ========== */}
                    <div className="comercial-help-section">
                        <div className="comercial-help-group-header">
                            <i className="fa-solid fa-boxes-stacked" style={{ color: '#EF5350' }} />
                            <h3>Módulo de Compras</h3>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-file-invoice-dollar" style={{ color: '#E53935' }} />Órdenes de Compra</h4>
                            <p>
                                Registran los pedidos a proveedores. Se selecciona el proveedor, se cargan los ítems con
                                cantidades, precios y moneda (ARS o USD). Los estados son: <strong>Borrador</strong>,
                                <strong> Confirmada</strong>, <strong>Recibida</strong> y <strong>Anulada</strong>.
                                Desde la orden se puede asociar facturas del proveedor y registrar pagos.
                                El sistema muestra el porcentaje facturado y pagado en tiempo real.
                            </p>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-file-lines" style={{ color: '#FF7043' }} />Facturas de Compra</h4>
                            <p>
                                Registran las facturas recibidas de proveedores. Se cargan con tipo de comprobante, número,
                                fecha, proveedor, ítems, IVA y retenciones aplicables. Se pueden asociar a una orden de compra
                                existente. Al guardar, impactan en la cuenta corriente del proveedor y en el Libro IVA Compras.
                            </p>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-cloud-arrow-up" style={{ color: '#FF9800' }} />Facturas Pendientes (OCR)</h4>
                            <p>
                                Funcionalidad de carga masiva de facturas de compra. Permite subir PDFs o imágenes de facturas,
                                el sistema las procesa automáticamente extrayendo datos como proveedor, número, fecha, montos
                                e ítems. Luego se revisan y confirman antes de registrarlas definitivamente.
                                Ideal para procesar muchas facturas de forma rápida.
                            </p>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-money-bill-transfer" style={{ color: '#FFA726' }} />Pagos</h4>
                            <p>
                                Registran los pagos realizados a proveedores. Se asocian a facturas de compra pendientes
                                de pago, indicando el medio de pago (efectivo, cheque, transferencia), monto, fecha y
                                retenciones aplicadas. Al confirmar, se actualiza la cuenta corriente del proveedor y
                                los movimientos de caja/banco correspondientes.
                            </p>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-scale-balanced" style={{ color: '#78909C' }} />Cuenta Corriente Proveedor</h4>
                            <p>
                                Estado de cuenta de cada proveedor: facturas recibidas, notas de crédito, pagos realizados
                                y saldo pendiente. Permite consultar el detalle de cada movimiento y filtrar por período.
                                Esencial para controlar las deudas con proveedores y planificar los pagos.
                            </p>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-tags" style={{ color: '#8D6E63' }} />Conceptos, Sectores y Centros de Costo</h4>
                            <p>
                                <strong>Conceptos de Compra:</strong> Categorías para clasificar las compras (ej: materiales,
                                servicios, combustible). <strong>Sectores de Costo:</strong> Agrupan gastos por área de la empresa.
                                <strong> Centros de Costo:</strong> Detallan aún más dónde se asigna el gasto. Esta estructura
                                permite analizar costos por sector y centro, facilitando el control presupuestario.
                            </p>
                        </div>
                    </div>

                    {/* ========== TESORERÍA ========== */}
                    <div className="comercial-help-section">
                        <div className="comercial-help-group-header">
                            <i className="fa-solid fa-vault" style={{ color: '#FFA726' }} />
                            <h3>Tesorería</h3>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-cash-register" style={{ color: '#66BB6A' }} />Cajas</h4>
                            <p>
                                Registran el dinero en efectivo disponible. Cada caja tiene un nombre y saldo actual.
                                Los movimientos se generan automáticamente al registrar cobranzas o pagos en efectivo,
                                o se pueden cargar manualmente (ingresos y egresos). Se puede consultar el historial
                                de movimientos de cada caja con fecha, concepto, tipo y monto.
                            </p>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-building-columns" style={{ color: '#42A5F5' }} />Bancos</h4>
                            <p>
                                Cuentas bancarias de la empresa. Cada banco tiene nombre, CBU/alias y saldo. Los movimientos
                                se registran al procesar transferencias, cheques o pagos/cobranzas bancarias.
                                Se puede consultar el extracto de cada cuenta con todos sus movimientos detallados.
                            </p>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-money-check" style={{ color: '#AB47BC' }} />Cheques</h4>
                            <p>
                                Gestión completa de cheques recibidos y emitidos. Permite registrar cheques de terceros
                                recibidos como medio de cobro, depositarlos en cuentas bancarias, endosarlos o aplicarlos
                                a pagos. También gestiona los cheques propios emitidos a proveedores. Cada cheque tiene
                                su estado: en cartera, depositado, cobrado, rechazado, endosado.
                            </p>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-right-left" style={{ color: '#78909C' }} />Transferencias</h4>
                            <p>
                                Movimientos de dinero entre cuentas propias: de caja a banco, de banco a caja, o entre
                                bancos. También permite registrar ajustes de saldo. Cada transferencia genera automáticamente
                                los movimientos correspondientes en las cuentas de origen y destino.
                            </p>
                        </div>
                    </div>

                    {/* ========== IMPUESTOS ========== */}
                    <div className="comercial-help-section">
                        <div className="comercial-help-group-header">
                            <i className="fa-solid fa-landmark" style={{ color: '#5C6BC0' }} />
                            <h3>Impuestos</h3>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-book" style={{ color: '#5C6BC0' }} />Libro IVA Digital</h4>
                            <p>
                                Genera el libro IVA de compras y ventas en formato digital, cumpliendo con el régimen
                                informativo de AFIP/ARCA. Consolida todas las facturas emitidas y recibidas del período,
                                discriminando base imponible, IVA y percepciones. Se puede exportar para la presentación
                                ante el organismo fiscal.
                            </p>
                        </div>

                        <div className="comercial-help-subsection">
                            <h4><i className="fa-solid fa-file-contract" style={{ color: '#8D6E63' }} />Retenciones</h4>
                            <p>
                                Gestión de retenciones impositivas aplicadas en pagos a proveedores (IIBB, Ganancias,
                                IVA, SUSS, etc.). Al registrar un pago con retenciones, se generan automáticamente los
                                certificados de retención. Permite consultar, filtrar por tipo/período, y generar el PDF
                                del certificado para entregar al proveedor.
                            </p>
                        </div>
                    </div>

                    {/* ========== ESTADOS DE COMPROBANTES ========== */}
                    <div className="comercial-help-section">
                        <h3><i className="fa-solid fa-circle-half-stroke mr-2" style={{ color: '#78909C' }} />Estados de Comprobantes</h3>
                        <p>Los comprobantes y órdenes pasan por distintos estados que se identifican con colores:</p>
                        <ul>
                            <li><strong style={{ color: '#6c757d' }}>Borrador (gris):</strong> En edición, se puede modificar libremente.</li>
                            <li><strong style={{ color: '#0288d1' }}>Confirmada (azul):</strong> Aprobada, lista para el siguiente paso del flujo.</li>
                            <li><strong style={{ color: '#2e7d32' }}>Facturada / Recibida (verde):</strong> Procesada completamente.</li>
                            <li><strong style={{ color: '#c62828' }}>Anulada (rojo):</strong> Cancelada, no tiene efecto contable.</li>
                        </ul>
                        <p>
                            En las órdenes de venta y compra, los íconos de <i className="fa-solid fa-file-invoice" /> factura
                            y <i className="fa-solid fa-money-bill-wave" /> cobro/pago cambian de color según el porcentaje
                            completado: <strong style={{ color: '#6c757d' }}>gris</strong> (0%),
                            <strong style={{ color: '#0288d1' }}> azul</strong> (parcial) y
                            <strong style={{ color: '#2e7d32' }}> verde</strong> (100%).
                        </p>
                    </div>

                    {/* ========== GLOSARIO ========== */}
                    <div className="comercial-help-section">
                        <h3><i className="fa-solid fa-spell-check mr-2" style={{ color: '#FF7043' }} />Glosario</h3>
                        <div className="comercial-help-glossary">
                            <div className="comercial-help-glossary-item">
                                <strong>Orden de Venta</strong>
                                <span>Pedido comercial de un cliente antes de facturar.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Orden de Compra</strong>
                                <span>Pedido que la empresa hace a un proveedor.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Remito</strong>
                                <span>Documento que acredita la entrega de mercadería.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Factura</strong>
                                <span>Comprobante fiscal por una venta o compra.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Nota de Crédito</strong>
                                <span>Comprobante que reduce el monto de una factura (devolución, bonificación).</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Nota de Débito</strong>
                                <span>Comprobante que aumenta el monto adeudado (intereses, ajustes).</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Cobranza</strong>
                                <span>Registro de un cobro recibido de un cliente.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Pago</strong>
                                <span>Registro de un pago realizado a un proveedor.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Cuenta Corriente</strong>
                                <span>Resumen de saldo entre la empresa y un cliente/proveedor.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>CUIT</strong>
                                <span>Clave Única de Identificación Tributaria (identifica al contribuyente ante AFIP).</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>IVA</strong>
                                <span>Impuesto al Valor Agregado. Se discrimina en facturas (21%, 10.5%, 27%, etc.).</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Retención</strong>
                                <span>Impuesto que se retiene al proveedor al momento de pagarle.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Percepción</strong>
                                <span>Impuesto adicional que se cobra al cliente junto con la factura.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Libro IVA</strong>
                                <span>Registro obligatorio de todas las facturas emitidas y recibidas para AFIP.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>AFIP / ARCA</strong>
                                <span>Organismo fiscal argentino. ARCA es el nuevo nombre de AFIP.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>CBU</strong>
                                <span>Clave Bancaria Uniforme, identifica una cuenta bancaria en Argentina.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Cheque</strong>
                                <span>Orden de pago contra una cuenta bancaria, de terceros o propio.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Alícuota</strong>
                                <span>Porcentaje de impuesto aplicable (ej: IVA 21%, IIBB 3.5%).</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Base Imponible</strong>
                                <span>Monto sobre el cual se calcula un impuesto.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Concepto de Compra</strong>
                                <span>Categoría para clasificar y agrupar gastos de compras.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Centro de Costo</strong>
                                <span>Unidad organizativa donde se asignan gastos para control presupuestario.</span>
                            </div>
                            <div className="comercial-help-glossary-item">
                                <strong>Moneda</strong>
                                <span>ARS (pesos argentinos) o USD (dólares estadounidenses).</span>
                            </div>
                        </div>
                    </div>

                    {/* ========== TIPS ========== */}
                    <div className="comercial-help-section comercial-help-tips">
                        <h3><i className="fa-solid fa-lightbulb mr-2" style={{ color: '#FDD835' }} />Consejos Útiles</h3>
                        <ul>
                            <li>Siempre creá la <strong>Orden de Venta/Compra primero</strong> y luego generá los comprobantes desde ahí. Así mantenés la trazabilidad completa.</li>
                            <li>Usá los <strong>filtros</strong> de estado, fecha y cliente/proveedor para encontrar documentos rápidamente.</li>
                            <li>Revisá las <strong>cuentas corrientes</strong> periódicamente para detectar saldos pendientes.</li>
                            <li>Antes de anular una factura, verificá que no tenga cobranzas/pagos asociados. Si los tiene, primero anulalos.</li>
                            <li>Las <strong>Notas de Crédito</strong> sirven para corregir facturas sin anularlas: devoluciones, descuentos, diferencias de precio.</li>
                            <li>Para cargar muchas facturas de compra, usá la funcionalidad de <strong>Facturas Pendientes (OCR)</strong> que procesa PDFs automáticamente.</li>
                            <li>Los <strong>cheques recibidos</strong> quedan "en cartera" hasta que los deposites o endoses. No te olvides de actualizarlos.</li>
                            <li>Configurá correctamente los <strong>Conceptos y Centros de Costo</strong> en compras para tener reportes de gastos más útiles.</li>
                            <li>Exportá datos a Excel desde cualquier tabla usando el botón de exportación para análisis detallados.</li>
                        </ul>
                    </div>

                </div>
            </Dialog>
        </>
    );
};

export default ComercialHelpDialog;
