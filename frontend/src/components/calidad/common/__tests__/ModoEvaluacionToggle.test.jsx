import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ModoEvaluacionToggle, { useModoEvaluacion } from '../ModoEvaluacionToggle';
import {
  MODO_NORMATIVO,
  MODO_DESCRIPTIVO,
  MODO_PRESCRIPTIVO,
  MODO_PRESTACIONAL,
} from '../../../../lib/evaluacion';

// Decisión 2026-05-28: el toggle usa nombres canónicos nuevos
// (DESCRIPTIVO / NORMATIVO). Los strings viejos PRESTACIONAL / PRESCRIPTIVO
// se aceptan como aliases entrada y son normalizados al canónico nuevo.

beforeEach(() => {
  window.localStorage.clear();
});

describe('useModoEvaluacion', () => {
  test('default DESCRIPTIVO si no hay valor en localStorage', () => {
    let result;
    function Comp() {
      const [modo] = useModoEvaluacion('test-1');
      result = modo;
      return null;
    }
    render(<Comp />);
    expect(result).toBe(MODO_DESCRIPTIVO);
  });

  test('lee valor previo (canónico nuevo) de localStorage', () => {
    window.localStorage.setItem('modoEvaluacion:test-2', MODO_NORMATIVO);
    let result;
    function Comp() {
      const [modo] = useModoEvaluacion('test-2');
      result = modo;
      return null;
    }
    render(<Comp />);
    expect(result).toBe(MODO_NORMATIVO);
  });

  test('back-compat: alias viejo PRESCRIPTIVO en localStorage se normaliza a NORMATIVO', () => {
    window.localStorage.setItem('modoEvaluacion:test-2b', MODO_PRESCRIPTIVO);
    let result;
    function Comp() {
      const [modo] = useModoEvaluacion('test-2b');
      result = modo;
      return null;
    }
    render(<Comp />);
    expect(result).toBe(MODO_NORMATIVO);
  });

  test('back-compat: alias viejo PRESTACIONAL en localStorage se normaliza a DESCRIPTIVO', () => {
    window.localStorage.setItem('modoEvaluacion:test-2c', MODO_PRESTACIONAL);
    let result;
    function Comp() {
      const [modo] = useModoEvaluacion('test-2c');
      result = modo;
      return null;
    }
    render(<Comp />);
    expect(result).toBe(MODO_DESCRIPTIVO);
  });

  test('setModo persiste el canónico nuevo en localStorage', () => {
    let setter;
    function Comp() {
      const [, setModo] = useModoEvaluacion('test-3');
      setter = setModo;
      return null;
    }
    render(<Comp />);
    act(() => setter(MODO_NORMATIVO));
    expect(window.localStorage.getItem('modoEvaluacion:test-3')).toBe(MODO_NORMATIVO);
  });

  test('ignora valores inválidos', () => {
    let setter, result;
    function Comp() {
      const [modo, setModo] = useModoEvaluacion('test-4');
      setter = setModo;
      result = modo;
      return null;
    }
    const { rerender } = render(<Comp />);
    act(() => setter('OTRO_MODO_NO_VALIDO'));
    rerender(<Comp />);
    expect(result).toBe(MODO_DESCRIPTIVO); // no cambió
  });

  test('valor previo inválido en localStorage cae al default DESCRIPTIVO', () => {
    window.localStorage.setItem('modoEvaluacion:test-5', 'BASURA');
    let result;
    function Comp() {
      const [modo] = useModoEvaluacion('test-5');
      result = modo;
      return null;
    }
    render(<Comp />);
    expect(result).toBe(MODO_DESCRIPTIVO);
  });
});

describe('ModoEvaluacionToggle (uncontrolled)', () => {
  test('renderiza ambas opciones (Descriptivo / Normativo)', () => {
    render(<ModoEvaluacionToggle pageKey="ui-1" />);
    expect(screen.getByText('Descriptivo')).toBeInTheDocument();
    expect(screen.getByText('Normativo')).toBeInTheDocument();
  });

  test('muestra banner DESCRIPTIVO por default', () => {
    render(<ModoEvaluacionToggle pageKey="ui-2" />);
    expect(screen.getByText(/sin emitir valoración normativa/i)).toBeInTheDocument();
  });

  test('ocultar banner cuando banner=false', () => {
    render(<ModoEvaluacionToggle pageKey="ui-3" banner={false} />);
    expect(screen.queryByText(/sin emitir valoración normativa/i)).not.toBeInTheDocument();
  });

  test('cambia de modo al click a Normativo', () => {
    render(<ModoEvaluacionToggle pageKey="ui-4" />);
    const normativoBtn = screen.getByText('Normativo');
    fireEvent.click(normativoBtn);
    // Banner ahora menciona la matriz CIRSOC
    expect(screen.getByText(/matriz CIRSOC 200-2024/i)).toBeInTheDocument();
    expect(window.localStorage.getItem('modoEvaluacion:ui-4')).toBe(MODO_NORMATIVO);
  });

  test('declarativo agrega aclaración de scope', () => {
    render(<ModoEvaluacionToggle pageKey="ui-5" declarativo />);
    expect(screen.getByText(/Indicación de scope/i)).toBeInTheDocument();
  });
});

describe('ModoEvaluacionToggle (controlled)', () => {
  test('respeta value externo (canónico nuevo)', () => {
    const onChange = jest.fn();
    render(
      <ModoEvaluacionToggle
        pageKey="ui-c1"
        value={MODO_NORMATIVO}
        onChange={onChange}
      />
    );
    expect(screen.getByText(/matriz CIRSOC 200-2024/i)).toBeInTheDocument();
  });

  test('respeta value externo en formato alias viejo (back-compat)', () => {
    const onChange = jest.fn();
    render(
      <ModoEvaluacionToggle
        pageKey="ui-c1b"
        value={MODO_PRESCRIPTIVO}
        onChange={onChange}
      />
    );
    expect(screen.getByText(/matriz CIRSOC 200-2024/i)).toBeInTheDocument();
  });

  test('llama onChange al cambiar (devuelve canónico nuevo)', () => {
    const onChange = jest.fn();
    render(
      <ModoEvaluacionToggle
        pageKey="ui-c2"
        value={MODO_DESCRIPTIVO}
        onChange={onChange}
      />
    );
    fireEvent.click(screen.getByText('Normativo'));
    expect(onChange).toHaveBeenCalledWith(MODO_NORMATIVO);
  });
});
