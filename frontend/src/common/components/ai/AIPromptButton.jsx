import React, { useState, useRef } from 'react';
import PropTypes from 'prop-types';
import axios from 'axios';
import { Button } from 'primereact/button';
import { confirmDialog } from 'primereact/confirmdialog';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { config } from '../../../config/config';

// Markdown
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

// PDF
import jsPDF from 'jspdf';
import 'jspdf-autotable';

const AIPromptButton = ({ label, confirmMessage, prompt, data }) => {
    const [visible, setVisible] = useState(false);
    const [loading, setLoading] = useState(false);
    const [response, setResponse] = useState('');

    const [exportVisible, setExportVisible] = useState(false);
    const [pdfTitle, setPdfTitle] = useState('');

    const markdownRef = useRef(null);

        const sendPrompt = async () => {
        setLoading(true);
        try {
            const payload = typeof data === 'string' ? data : JSON.stringify(data);
            const { data: res } = await axios.post(
                `${config.backendUrl}/api/ai/prompt`,
                { prompt, data: payload },
                { headers: config.headers },
            );
            setResponse(res.response || '');
        } catch (err) {
            console.error('Error generando respuesta', err);
            setResponse('No se pudo generar la respuesta.');
        } finally {
            setLoading(false);
            setVisible(true);
        }
    };

    const handleClick = () => {
        confirmDialog({
            message: (
                <div className='flex flex-column py-5 px-3 gap-4 text-center'>
                    <i className='fa-solid fa-triangle-exclamation' style={{ fontSize: '3rem', color: 'var(--orange-300)' }}></i>
                    {confirmMessage}
                </div>
            ),
            header: label,
            acceptLabel: 'Aceptar',
            rejectLabel: 'Cancelar',
            rejectClassName: 'p-button-secondary',
            accept: sendPrompt,
        });
    };

    const sanitizeFilename = (name) => name.replace(/[\\/:*?"<>|]/g, '_');


    const parseMarkdownToPdfElements = (markdownText) => {
        const elements = [];
        const lines = markdownText.split('\n');
        let i = 0;

        while (i < lines.length) {
            const line = lines[i].trim();

            // Títulos
            if (line.startsWith('### ')) {
                elements.push({ type: 'h3', text: line.substring(4) });
            } else if (line.startsWith('## ')) {
                elements.push({ type: 'h2', text: line.substring(3) });
            } else if (line.startsWith('# ')) {
                elements.push({ type: 'h1', text: line.substring(2) });
            }
            // Lista con viñetas
            else if (line.startsWith('- ') || line.startsWith('* ')) {
                const items = [];
                while (i < lines.length && (lines[i].trim().startsWith('- ') || lines[i].trim().startsWith('* '))) {
                    items.push(lines[i].trim().substring(2));
                    i++;
                }
                i--; // Retroceder uno porque el while principal incrementará
                elements.push({ type: 'list', items });
            }
            // Lista numerada
            else if (/^\d+\.\s/.test(line)) {
                const items = [];
                while (i < lines.length && /^\d+\.\s/.test(lines[i].trim())) {
                    items.push(lines[i].trim().replace(/^\d+\.\s/, ''));
                    i++;
                }
                i--;
                elements.push({ type: 'numberedList', items });
            }
            // Párrafo normal
            else if (line.length > 0) {
                elements.push({ type: 'paragraph', text: line });
            }
            // Espacio vacío
            else {
                elements.push({ type: 'space' });
            }

            i++;
        }

        return elements;
    };

    const cleanMarkdownFormatting = (text) => {
        return text
            .replace(/\*\*(.+?)\*\*/g, '$1')  // Negritas
            .replace(/\*(.+?)\*/g, '$1')       // Cursivas
            .replace(/`(.+?)`/g, '$1')         // Código inline
            .replace(/\[(.+?)\]\(.+?\)/g, '$1'); // Links
    };

    const handleGeneratePdf = async () => {
        const title = pdfTitle.trim() || label;
        const filename = sanitizeFilename(title) + '.pdf';

        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const margin = 20;
        const usableWidth = pageWidth - margin * 2;
        let cursorY = margin;

        // Función para agregar encabezado
        const addHeader = () => {
            doc.setFillColor(41, 128, 185);
            doc.rect(0, 0, pageWidth, 15, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(10);
            doc.text(title, margin, 10);
        };

        // Función para agregar pie de página
        const addFooter = (pageNum, totalPages) => {
            doc.setTextColor(128, 128, 128);
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.text(
                `Página ${pageNum} de ${totalPages}`,
                pageWidth / 2,
                pageHeight - 10,
                { align: 'center' }
            );
            const fecha = new Date().toLocaleDateString('es-AR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            doc.text(fecha, pageWidth - margin, pageHeight - 10, { align: 'right' });
        };

        // Función para verificar si necesitamos nueva página
        const checkPageBreak = (requiredSpace) => {
            if (cursorY + requiredSpace > pageHeight - 25) {
                doc.addPage();
                cursorY = margin + 20;
                return true;
            }
            return false;
        };

        // Agregar primera página con encabezado
        addHeader();
        cursorY = 25;

        // Parsear el markdown
        const elements = parseMarkdownToPdfElements(response);

        // Renderizar cada elemento
        elements.forEach((element) => {
            doc.setTextColor(0, 0, 0);

            switch (element.type) {
                case 'h1':
                    checkPageBreak(15);
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(16);
                    doc.setTextColor(41, 128, 185);
                    doc.text(cleanMarkdownFormatting(element.text), margin, cursorY);
                    cursorY += 10;
                    break;

                case 'h2':
                    checkPageBreak(12);
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(14);
                    doc.setTextColor(52, 73, 94);
                    doc.text(cleanMarkdownFormatting(element.text), margin, cursorY);
                    cursorY += 8;
                    break;

                case 'h3':
                    checkPageBreak(10);
                    doc.setFont('helvetica', 'bold');
                    doc.setFontSize(12);
                    doc.setTextColor(52, 73, 94);
                    doc.text(cleanMarkdownFormatting(element.text), margin, cursorY);
                    cursorY += 7;
                    break;

                case 'paragraph':
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(10);
                    doc.setTextColor(0, 0, 0);
                    const cleanedText = cleanMarkdownFormatting(element.text);
                    const lines = doc.splitTextToSize(cleanedText, usableWidth);

                    checkPageBreak(lines.length * 5);

                    lines.forEach(line => {
                        if (cursorY > pageHeight - 25) {
                            doc.addPage();
                            addHeader();
                            cursorY = 25;
                        }
                        doc.text(line, margin, cursorY);
                        cursorY += 5;
                    });
                    cursorY += 2;
                    break;

                case 'list':
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(10);
                    element.items.forEach(item => {
                        const cleanedItem = cleanMarkdownFormatting(item);
                        const itemLines = doc.splitTextToSize(cleanedItem, usableWidth - 5);

                        checkPageBreak(itemLines.length * 5);

                        doc.circle(margin + 1.5, cursorY - 1.5, 0.8, 'F');
                        itemLines.forEach((line) => {
                            if (cursorY > pageHeight - 25) {
                                doc.addPage();
                                addHeader();
                                cursorY = 25;
                            }
                            doc.text(line, margin + 5, cursorY);
                            cursorY += 5;
                        });
                    });
                    cursorY += 2;
                    break;

                case 'numberedList':
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(10);
                    element.items.forEach((item, idx) => {
                        const cleanedItem = cleanMarkdownFormatting(item);
                        const itemLines = doc.splitTextToSize(cleanedItem, usableWidth - 8);

                        checkPageBreak(itemLines.length * 5);

                        doc.text(`${idx + 1}.`, margin, cursorY);
                        itemLines.forEach((line) => {
                            if (cursorY > pageHeight - 25) {
                                doc.addPage();
                                addHeader();
                                cursorY = 25;
                            }
                            doc.text(line, margin + 8, cursorY);
                            cursorY += 5;
                        });
                    });
                    cursorY += 2;
                    break;

                case 'space':
                    cursorY += 3;
                    break;

                default:
                    break;
            }
        });

        // Agregar pies de página a todas las páginas
        const totalPages = doc.internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            addFooter(i, totalPages);
        }

        // Guardar
        doc.save(filename);
        setExportVisible(false);
    };


    return (
        <>
            <Button
                label={label}
                icon="fa-solid fa-brain"
                size='small'
                rounded
                onClick={handleClick}
                loading={loading}
                className="mr-2"
            />
            <Dialog
                header={label}
                visible={visible}
                onHide={() => setVisible(false)}
                style={{ width: '50vw', fontFamily: 'Poppins, sans-serif' }}
                footer={
                    <div className='w-full flex justify-content-end dialog-footer'>
                        <Button
                            label='Exportar a PDF'
                            size='small'
                            icon='fa-solid fa-file-pdf'
                            onClick={() => { setPdfTitle(label); setExportVisible(true); }}
                            rounded
                            disabled={!response}
                        />
                        <Button
                            label='Cerrar'
                            size='small'
                            severity='secondary'
                            icon='fa-solid fa-xmark'
                            onClick={() => setVisible(false)}
                            rounded
                            className='flex align-self-end'
                        />
                    </div>
                }
            >
                <div className="prose px-2 text-justify" ref={markdownRef}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {response}
                    </ReactMarkdown>
                </div>

            </Dialog>

            <Dialog
                header="Exportar a PDF"
                visible={exportVisible}
                onHide={() => setExportVisible(false)}
                style={{ width: '30rem' }}
                footer={
                    <div className="flex justify-content-end">
                        <Button
                            label="Cancelar"
                            size="small"
                            outlined
                            rounded
                            onClick={() => setExportVisible(false)}
                        />
                        <Button
                            label="Generar"
                            size="small"
                            icon="fa-solid fa-download"
                            rounded
                            onClick={handleGeneratePdf}
                            disabled={!response}
                        />
                    </div>
                }
            >
                <div className="flex flex-column gap-3">
                    <span className="font-semibold">Título del PDF</span>
                    <InputText
                        value={pdfTitle}
                        onChange={(e) => setPdfTitle(e.target.value)}
                        placeholder="Ingrese un título"
                    />

                </div>
            </Dialog>
        </>
    );
};

AIPromptButton.propTypes = {
    label: PropTypes.string.isRequired,
    confirmMessage: PropTypes.string.isRequired,
    prompt: PropTypes.string.isRequired,
        data: PropTypes.oneOfType([
        PropTypes.string,
        PropTypes.object,
        PropTypes.array,
    ]).isRequired,
};

export default AIPromptButton;
