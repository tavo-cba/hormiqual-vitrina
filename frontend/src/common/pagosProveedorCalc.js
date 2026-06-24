/**
 * pagosProveedorCalc.js — Cálculo robusto de "cuánto se pagó" a facturas de compra.
 *
 * POR QUÉ EXISTE
 * `PagoFactura.importeAplicado` y `Pago.importe` quedaron guardados de forma
 * inconsistente entre pagos (unos en NETO, otros en BRUTO con las retenciones
 * incluidas). Por eso ningún cálculo puede confiar en esos campos como monto.
 *
 * Este módulo reconstruye el monto desde DATOS PRIMARIOS confiables:
 *   monto cubierto por un recibo = Σ medios de pago + Σ retenciones practicadas
 *                                  + Σ saldo a favor aplicado
 * `importeAplicado` se usa SÓLO para repartir la proporción entre facturas,
 * nunca como monto absoluto. Los "pagos de retención" (Pago sintético con
 * tipoComprobante 'retencion*') NO se cuentan: su monto ya está dentro de las
 * retenciones del recibo principal.
 *
 * Es la fuente única de verdad: todo cálculo de pagado/saldo de proveedor debe
 * consumir estas funciones en vez de reimplementar la lógica.
 *
 * ESPEJO: mantener sincronizado con Backend/src/services/pagosProveedorCalc.js
 * (misma lógica; sólo cambia require/module.exports vs import/export).
 */

const num = (v) => Math.abs(Number(v || 0));

/**
 * ¿Es un "pago de retención"? Pago sintético que representa la obligación con
 * el fisco. No se cuenta como pago a la factura.
 */
export function esPagoRetencion(pago) {
    return String(pago && pago.tipoComprobante || '').toLowerCase().startsWith('retencion');
}

/**
 * Saldos a favor aplicados a un pago. Acepta el array nuevo `saldosFavorAplicados`
 * o el par escalar legado `saldoFavorAplicado` + `idFacturaCompraSaldoFavor`/`idPagoSaldoFavor`.
 */
export function saldosFavorDePago(pago) {
    if (Array.isArray(pago && pago.saldosFavorAplicados) && pago.saldosFavorAplicados.length > 0) {
        return pago.saldosFavorAplicados;
    }
    if (Number(pago && pago.saldoFavorAplicado || 0) > 0) {
        return [{
            importe: Number(pago.saldoFavorAplicado),
            idPagoOrigen: pago.idPagoSaldoFavor || null,
            idFacturaCompraOrigen: pago.idFacturaCompraSaldoFavor || null,
            facturaCompraOrigen: pago.facturaCompraSaldoFavor || null,
        }];
    }
    return [];
}

/**
 * Monto que un recibo cubre, robusto a neto/bruto:
 *   medios de pago reales + retenciones practicadas + saldo a favor aplicado.
 * Fallback a `pago.importe` sólo para pagos legacy sin medios cargados.
 */
export function montoCubiertoDePago(pago) {
    const medios = (Array.isArray(pago && pago.mediosPago) ? pago.mediosPago : [])
        .reduce((s, mp) => s + num(mp.importe), 0);
    const retenciones = (Array.isArray(pago && pago.retenciones) ? pago.retenciones : [])
        .reduce((s, r) => s + num(r.importeRetenido), 0);
    const saldoFavor = saldosFavorDePago(pago).reduce((s, x) => s + num(x.importe), 0);
    const cash = medios > 0 ? medios : Math.max(0, Number(pago && pago.importe || 0));
    return cash + retenciones + saldoFavor;
}

/**
 * Contribución de UN pago a cada factura. Devuelve un array de items:
 *   { idFacturaCompra, currency, monto, tipo }
 *   - tipo 'aplicado'      → monto pagado a una factura positiva.
 *   - tipo 'nc-item'       → ítem negativo (NC usada como descuento en el pago).
 *   - tipo 'nc-compensada' → factura negativa marcada como consumida por un saldo a favor.
 * Para pagos de retención devuelve [] (no aportan; ya contados en el recibo).
 */
export function contribucionPago(pago, opts) {
    const monedaPorDefecto = (opts && opts.monedaPorDefecto) || 'ARS';
    if (esPagoRetencion(pago)) return [];

    const out = [];
    const fApl = Array.isArray(pago && pago.facturasAplicadas) ? pago.facturasAplicadas : [];
    const idDe = (fa) => (fa.facturaCompra && fa.facturaCompra.idFacturaCompra) || fa.idFacturaCompra;
    const monedaDe = (fa) => (fa.facturaCompra && fa.facturaCompra.moneda)
        || (pago && pago.moneda) || monedaPorDefecto;

    const montoCubierto = montoCubiertoDePago(pago);

    // Repartir el monto cubierto entre las facturas positivas, proporcional a
    // importeAplicado (la proporción vale esté importeAplicado en neto o bruto).
    const positivas = fApl.filter((fa) => Number(fa && fa.importeAplicado || 0) > 0);
    const totalPos = positivas.reduce((s, fa) => s + Number(fa.importeAplicado || 0), 0);
    if (totalPos > 0) {
        for (const fa of positivas) {
            const idF = idDe(fa);
            if (!idF) continue;
            out.push({
                idFacturaCompra: idF,
                currency: monedaDe(fa),
                monto: montoCubierto * (Number(fa.importeAplicado || 0) / totalPos),
                tipo: 'aplicado',
            });
        }
    }

    // Facturas negativas dentro del recibo (NC como ítem de descuento): crudo.
    for (const fa of fApl) {
        const v = Number(fa && fa.importeAplicado || 0);
        if (v >= 0) continue;
        const idF = idDe(fa);
        if (!idF) continue;
        out.push({ idFacturaCompra: idF, currency: monedaDe(fa), monto: v, tipo: 'nc-item' });
    }

    // Cada saldo a favor de origen marca su factura negativa como compensada.
    for (const sf of saldosFavorDePago(pago)) {
        const imp = num(sf.importe);
        if (!sf.idFacturaCompraOrigen || imp <= 0) continue;
        out.push({
            idFacturaCompra: sf.idFacturaCompraOrigen,
            currency: (sf.facturaCompraOrigen && sf.facturaCompraOrigen.moneda)
                || (pago && pago.moneda) || monedaPorDefecto,
            monto: -imp,
            tipo: 'nc-compensada',
        });
    }
    return out;
}

/**
 * Acumula la contribución de varios pagos.
 * Devuelve { [idFacturaCompra]: { ARS: number, USD: number } }.
 */
export function calcularPagadoPorFactura(pagos, opts) {
    const acc = {};
    for (const pago of (Array.isArray(pagos) ? pagos : [])) {
        for (const c of contribucionPago(pago, opts)) {
            if (!acc[c.idFacturaCompra]) acc[c.idFacturaCompra] = { ARS: 0, USD: 0 };
            const cur = acc[c.idFacturaCompra][c.currency] !== undefined ? c.currency : 'ARS';
            acc[c.idFacturaCompra][cur] += c.monto;
        }
    }
    return acc;
}

/**
 * Igual que calcularPagadoPorFactura pero aplana las monedas en un solo número
 * por factura: { [idFacturaCompra]: number }. Para consumidores mono-moneda.
 */
export function calcularPagadoPorFacturaPlano(pagos, opts) {
    const porMoneda = calcularPagadoPorFactura(pagos, opts);
    const out = {};
    for (const idF of Object.keys(porMoneda)) {
        out[idF] = porMoneda[idF].ARS + porMoneda[idF].USD;
    }
    return out;
}
