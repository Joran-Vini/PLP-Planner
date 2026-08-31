import { TitleCasePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { Categoria } from '../../core/models/categoria.model';
import { Lembrete, LembretePayload, TipoLembrete } from '../../core/models/lembrete.model';
import {
  DuracaoTarefa,
  PrioridadeTarefa,
  StatusTarefa,
  Tarefa,
  TarefaPayload,
  TurnoTarefa,
} from '../../core/models/tarefa.model';
import { CategoriaService } from '../../core/services/categoria.service';
import { LembreteService } from '../../core/services/lembrete.service';
import { TarefaService } from '../../core/services/tarefa.service';
import { formatarDataLocal, paraDataApi, paraDataInput } from '../../core/utils/date-format.util';
import { intervaloSemana } from '../../core/utils/date-range.util';

type AbaTarefas = 'agenda' | 'lembretes';
type ModoAgenda = 'dia' | 'semana';

interface DiaLembrete {
  iso: string;
  rotulo: string;
  ehHoje: boolean;
  itens: Lembrete[];
}

interface DiaTarefa {
  iso: string;
  rotulo: string;
  ehHoje: boolean;
  itens: Tarefa[];
}

const ORDEM_TURNO: Record<string, number> = { 'manhã': 0, tarde: 1, noite: 2 };

export type TipoGranularidade = '30min' | '1h' | 'turno';

export interface BlocoTempo {
  rotulo: string;
  inicio: string;
  fim: string;
  turno?: TurnoTarefa;
}

const STATUS_OPCOES: StatusTarefa[] = [
  'pendente',
  'executada',
  'parcialmente executada',
  'adiada',
  'cancelada',
];

const PRIORIDADE_OPCOES: PrioridadeTarefa[] = ['baixa', 'média', 'alta'];

const TIPOS_LEMBRETE: TipoLembrete[] = [
  'reunião',
  'ligação',
  'compra',
  'estudo',
  'exercício',
  'entrega',
];

const CORES_TIPO_LEMBRETE: Record<TipoLembrete, string> = {
  reunião: '#d0ebff',
  ligação: '#eebefa',
  compra: '#fff3bf',
  estudo: '#c3fae8',
  exercício: '#d3f9d8',
  entrega: '#ffc9c9',
};

@Component({
  selector: 'app-tarefas-diarias',
  standalone: true,
  imports: [ReactiveFormsModule, TitleCasePipe],
  templateUrl: './tarefas-diarias.html',
  styleUrl: './tarefas-diarias.css',
})
export class TarefasDiarias {
  private readonly fb = inject(FormBuilder);
  private readonly tarefaService = inject(TarefaService);
  private readonly lembreteService = inject(LembreteService);
  private readonly categoriaService = inject(CategoriaService);

  protected readonly statusOpcoes = STATUS_OPCOES;
  protected readonly prioridadeOpcoes = PRIORIDADE_OPCOES;
  protected readonly tiposLembreteOpcoes = TIPOS_LEMBRETE;

  protected readonly dataReferencia = signal(new Date());
  protected readonly granularidade = signal<TipoGranularidade>('1h');
  protected readonly tarefas = signal<Tarefa[]>([]);
  protected readonly lembretes = signal<Lembrete[]>([]);
  protected readonly categorias = signal<Categoria[]>([]);
  protected readonly exibindoModalTarefa = signal(false);
  protected readonly tarefaEmEdicao = signal<Tarefa | null>(null);
  protected readonly tipoAgendamento = signal<'horario' | 'turno'>('horario');
  protected readonly abaAtiva = signal<AbaTarefas>('agenda');
  protected readonly modoAgenda = signal<ModoAgenda>('dia');
  protected readonly tarefasSemana = signal<Tarefa[]>([]);

  protected readonly categoriaPorId = computed(
    () => new Map(this.categorias().map((c) => [c.id, c]))
  );

  protected readonly tituloModalTarefa = computed(() =>
    this.tarefaEmEdicao() ? 'Editar Tarefa' : 'Nova Tarefa'
  );

  protected readonly dataFormatada = computed(() => {
    return new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(this.dataReferencia());
  });

  protected readonly dataIso = computed(() => formatarDataLocal(this.dataReferencia()));

  protected readonly ehHoje = computed(
    () => this.dataIso() === formatarDataLocal(new Date())
  );

  protected readonly rotuloDiaSelecionado = computed(() =>
    new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
    }).format(this.dataReferencia())
  );

  protected readonly semanaSelecionada = computed(() => intervaloSemana(this.dataReferencia()));

  protected readonly rotuloSemana = computed(() => {
    const { inicio, fim } = this.semanaSelecionada();
    const fmt = (d: Date) =>
      new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' })
        .format(d)
        .replaceAll('.', '');
    return `${fmt(inicio)} a ${fmt(fim)} de ${fim.getFullYear()}`;
  });

  protected readonly lembretesPorDia = computed<DiaLembrete[]>(() => {
    const { inicio } = this.semanaSelecionada();
    const hojeIso = formatarDataLocal(new Date());

    const porData = new Map<string, Lembrete[]>();
    for (const lembrete of this.lembretes()) {
      const lista = porData.get(lembrete.data) ?? [];
      lista.push(lembrete);
      porData.set(lembrete.data, lista);
    }

    return Array.from({ length: 7 }, (_, i) => {
      const dia = new Date(inicio);
      dia.setDate(inicio.getDate() + i);
      const iso = formatarDataLocal(dia);

      return {
        iso,
        ehHoje: iso === hojeIso,
        rotulo: new Intl.DateTimeFormat('pt-BR', {
          weekday: 'long',
          day: '2-digit',
          month: 'long',
        }).format(dia),
        itens: (porData.get(iso) ?? []).sort((a, b) => a.horario.localeCompare(b.horario)),
      };
    });
  });

  protected readonly tarefasSemanaPorDia = computed<DiaTarefa[]>(() => {
    const { inicio } = this.semanaSelecionada();
    const hojeIso = formatarDataLocal(new Date());

    const porData = new Map<string, Tarefa[]>();
    for (const tarefa of this.tarefasSemana()) {
      const iso = String(tarefa.data).slice(0, 10);
      const lista = porData.get(iso) ?? [];
      lista.push(tarefa);
      porData.set(iso, lista);
    }

    return Array.from({ length: 7 }, (_, i) => {
      const dia = new Date(inicio);
      dia.setDate(inicio.getDate() + i);
      const iso = formatarDataLocal(dia);

      return {
        iso,
        ehHoje: iso === hojeIso,
        rotulo: new Intl.DateTimeFormat('pt-BR', {
          weekday: 'short',
          day: '2-digit',
          month: 'short',
        })
          .format(dia)
          .replaceAll('.', ''),
        itens: (porData.get(iso) ?? []).sort(
          (a, b) => this.ordemTarefa(a) - this.ordemTarefa(b)
        ),
      };
    });
  });

  private ordemTarefa(t: Tarefa): number {
    if (t.horario_inicio) {
      const [h, m] = t.horario_inicio.split(':').map(Number);
      return h * 60 + m;
    }
    if (t.turno) {
      return 2000 + (ORDEM_TURNO[t.turno] ?? 9);
    }
    return 9999;
  }

  protected readonly blocosGrade = computed<BlocoTempo[]>(() => {
    const modo = this.granularidade();

    if (modo === '30min') {
      const blocos: BlocoTempo[] = [];
      for (let h = 8; h <= 18; h++) {
        const hPad = h.toString().padStart(2, '0');
        const hProx = (h + 1).toString().padStart(2, '0');
        blocos.push({ rotulo: `${hPad}:00`, inicio: `${hPad}:00`, fim: `${hPad}:30` });
        blocos.push({ rotulo: `${hPad}:30`, inicio: `${hPad}:30`, fim: `${hProx}:00` });
      }
      return blocos;
    }

    if (modo === '1h') {
      return Array.from({ length: 11 }, (_, i) => {
        const h = i + 8;
        const hPad = h.toString().padStart(2, '0');
        const hProx = (h + 1).toString().padStart(2, '0');
        return { rotulo: `${hPad}:00`, inicio: `${hPad}:00`, fim: `${hProx}:00` };
      });
    }

    return [
      { rotulo: 'Manhã', inicio: '06:00', fim: '12:00', turno: 'manhã' },
      { rotulo: 'Tarde', inicio: '12:00', fim: '18:00', turno: 'tarde' },
      { rotulo: 'Noite', inicio: '18:00', fim: '23:59', turno: 'noite' },
    ];
  });

  protected readonly formTarefa = this.fb.nonNullable.group({
    descricao: ['', Validators.required],
    data: [this.dataIso(), Validators.required],
    categoriaId: [1, [Validators.required, Validators.min(1)]],
    prioridade: ['média' as PrioridadeTarefa, Validators.required],
    status: ['pendente' as StatusTarefa, Validators.required],
    horarioInicio: ['09:00'],
    duracao: ['1h' as DuracaoTarefa],
    turno: ['manhã' as TurnoTarefa],
  });

  protected readonly formLembrete = this.fb.nonNullable.group({
    descricao: ['', Validators.required],
    tipo: ['compra' as TipoLembrete, Validators.required],
    data: [this.dataIso(), Validators.required],
    horario: ['10:00', Validators.required],
    recorrente: [false],
  });

  constructor() {
    this.carregarCategorias();
    this.carregarDadosDoDia();
  }

  private carregarCategorias(): void {
    this.categoriaService.listarTodas().subscribe({
      next: (cats) => this.categorias.set(cats ?? []),
      error: (err) => console.error('Erro ao buscar categorias do backend:', err),
    });
  }

  private carregarDadosDoDia(): void {
    this.carregarTarefasDoDia();

    if (this.abaAtiva() === 'agenda' && this.modoAgenda() === 'semana') {
      this.carregarTarefasDaSemana();
    }

    this.carregarLembretesDaSemana();
  }

  private carregarTarefasDoDia(): void {
    this.tarefaService.buscarPorData(this.dataIso()).subscribe({
      next: (dados) => this.tarefas.set(dados ?? []),
      error: (err) => console.error('Erro ao buscar tarefas:', err),
    });
  }

  private carregarTarefasDaSemana(): void {
    const { inicio } = this.semanaSelecionada();

    const requisicoes = Array.from({ length: 7 }, (_, i) => {
      const dia = new Date(inicio);
      dia.setDate(inicio.getDate() + i);
      return this.tarefaService.buscarPorData(formatarDataLocal(dia));
    });

    forkJoin(requisicoes).subscribe({
      next: (listas) => this.tarefasSemana.set(listas.flatMap((l) => l ?? [])),
      error: (err) => {
        console.error('Erro ao buscar tarefas da semana:', err);
        this.tarefasSemana.set([]);
      },
    });
  }

  private carregarLembretesDaSemana(): void {
    const { inicio, fim } = this.semanaSelecionada();

    this.lembreteService
      .buscarTodos(formatarDataLocal(inicio), formatarDataLocal(fim))
      .subscribe({
        next: (dados) => this.lembretes.set(dados ?? []),
        error: (err) => {
          console.warn('Não foi possível carregar os lembretes:', err);
          this.lembretes.set([]);
        },
      });
  }

  protected mudarModoAgenda(modo: ModoAgenda): void {
    if (this.modoAgenda() === modo) return;
    this.modoAgenda.set(modo);
    this.carregarDadosDoDia();
  }

  protected navegar(delta: number): void {
    const porSemana =
      this.abaAtiva() === 'lembretes' ||
      (this.abaAtiva() === 'agenda' && this.modoAgenda() === 'semana');

    const proxima = new Date(this.dataReferencia());
    proxima.setDate(proxima.getDate() + (porSemana ? delta * 7 : delta));
    this.dataReferencia.set(proxima);
    this.carregarDadosDoDia();
  }

  protected irParaHoje(): void {
    this.dataReferencia.set(new Date());
    this.carregarDadosDoDia();
  }

  private readonly padroesFormTarefa = {
    descricao: '',
    data: '',
    categoriaId: 1,
    prioridade: 'média' as PrioridadeTarefa,
    status: 'pendente' as StatusTarefa,
    horarioInicio: '09:00',
    duracao: '1h' as DuracaoTarefa,
    turno: 'manhã' as TurnoTarefa,
  };

  protected abrirModalNovaTarefa(): void {
    this.tarefaEmEdicao.set(null);
    this.tipoAgendamento.set('horario');
    this.formTarefa.reset({ ...this.padroesFormTarefa, data: this.dataIso() });
    this.exibindoModalTarefa.set(true);
  }

  protected abrirModalEdicaoTarefa(tarefa: Tarefa): void {
    this.tarefaEmEdicao.set(tarefa);
    this.tipoAgendamento.set(tarefa.turno ? 'turno' : 'horario');
    this.formTarefa.reset({
      ...this.padroesFormTarefa,
      descricao: tarefa.descricao,
      data: paraDataInput(String(tarefa.data)),
      categoriaId: tarefa.categoria_id,
      prioridade: tarefa.prioridade,
      status: tarefa.status,
      horarioInicio: tarefa.horario_inicio ?? '09:00',
      duracao: tarefa.duracao ?? '1h',
      turno: tarefa.turno ?? 'manhã',
    });
    this.exibindoModalTarefa.set(true);
  }

  protected fecharModalTarefa(): void {
    this.exibindoModalTarefa.set(false);
    this.tarefaEmEdicao.set(null);
  }

  protected tarefasDoBloco(bloco: BlocoTempo): Tarefa[] {
    if (this.granularidade() === 'turno') {
      return this.tarefas().filter((t) => {
        if (t.turno) return t.turno === bloco.turno;
        if (t.horario_inicio) return t.horario_inicio >= bloco.inicio && t.horario_inicio < bloco.fim;
        return false;
      });
    }

    return this.tarefas().filter(
      (t) => t.horario_inicio && t.horario_inicio >= bloco.inicio && t.horario_inicio < bloco.fim
    );
  }

  protected tarefasPorTurno(): Tarefa[] {
    return this.tarefas().filter((t) => !!t.turno && this.granularidade() !== 'turno');
  }

  protected corDaCategoria(idCategoria: number): string {
    return this.categoriaPorId().get(idCategoria)?.cor ?? '#adb5bd';
  }

  protected nomeDaCategoria(idCategoria: number): string {
    return this.categoriaPorId().get(idCategoria)?.nome ?? 'Geral';
  }

  protected corDoTipoLembrete(tipo: TipoLembrete): string {
    return CORES_TIPO_LEMBRETE[tipo] ?? '#fff3bf';
  }

  protected mudarStatusTarefa(tarefa: Tarefa, novoStatus: StatusTarefa): void {
    this.tarefaService.atualizarStatus(tarefa.id, novoStatus).subscribe({
      next: () => {
        const aplicar = (lista: Tarefa[]) =>
          lista.map((t) => (t.id === tarefa.id ? { ...t, status: novoStatus } : t));
        this.tarefas.update(aplicar);
        this.tarefasSemana.update(aplicar);
      },
      error: (err) => console.error('Erro ao atualizar status da tarefa:', err),
    });
  }

  protected excluirLembrete(lembrete: Lembrete): void {
    if (
      lembrete.recorrente &&
      !confirm('Este lembrete se repete toda semana. Excluir remove todas as ocorrências. Continuar?')
    ) {
      return;
    }

    this.lembreteService.excluir(lembrete.id).subscribe({
      next: () => this.carregarLembretesDaSemana(),
      error: (err) => console.error('Erro ao excluir lembrete:', err),
    });
  }

  protected salvarTarefa(): void {
    if (this.formTarefa.invalid) return;
    const v = this.formTarefa.getRawValue();

    const ehHorario = this.tipoAgendamento() === 'horario';

    const payload: TarefaPayload = {
      descricao: v.descricao.trim(),
      categoria_id: Number(v.categoriaId),
      data: paraDataApi(v.data),
      status: v.status,
      prioridade: v.prioridade,
      ...(ehHorario
        ? {
            horario_inicio: v.horarioInicio,
            duracao: v.duracao,
          }
        : {
            turno: v.turno,
          }),
    };

    const emEdicao = this.tarefaEmEdicao();
    const requisicao = emEdicao
      ? this.tarefaService.atualizar(emEdicao.id, payload)
      : this.tarefaService.criar(payload);

    requisicao.subscribe({
      next: (tarefaSalva) => {
        const dataSalva = String(tarefaSalva.data).slice(0, 10);

        if (dataSalva !== this.dataIso()) {
          const [ano, mes, dia] = dataSalva.split('-').map(Number);
          this.dataReferencia.set(new Date(ano, mes - 1, dia));
          this.carregarDadosDoDia();
        } else if (emEdicao) {
          const aplicar = (lista: Tarefa[]) =>
            lista.map((t) => (t.id === tarefaSalva.id ? tarefaSalva : t));
          this.tarefas.update(aplicar);
          this.tarefasSemana.update(aplicar);
        } else {
          this.tarefas.update((lista) => [...lista, tarefaSalva]);
          if (this.modoAgenda() === 'semana') {
            this.tarefasSemana.update((lista) => [...lista, tarefaSalva]);
          }
        }

        this.fecharModalTarefa();
      },
      error: (err) => console.error('Erro ao salvar tarefa no backend:', err),
    });
  }

  protected excluirTarefa(tarefa: Tarefa): void {
    if (!confirm(`Excluir a tarefa "${tarefa.descricao}"?`)) return;

    this.tarefaService.excluir(tarefa.id).subscribe({
      next: () => {
        const remover = (lista: Tarefa[]) => lista.filter((t) => t.id !== tarefa.id);
        this.tarefas.update(remover);
        this.tarefasSemana.update(remover);
        if (this.tarefaEmEdicao()?.id === tarefa.id) {
          this.fecharModalTarefa();
        }
      },
      error: (err) => console.error('Erro ao excluir tarefa no backend:', err),
    });
  }

  protected adicionarLembrete(): void {
    if (this.formLembrete.invalid) return;
    const v = this.formLembrete.getRawValue();

    const payload: LembretePayload = {
      descricao: v.descricao.trim(),
      tipo: v.tipo,
      data: v.data,
      horario: v.horario,
      recorrente: v.recorrente,
    };

    this.lembreteService.criar(payload).subscribe({
      next: () => {
        this.carregarLembretesDaSemana();
        this.formLembrete.reset({
          tipo: 'compra',
          data: this.dataIso(),
          horario: '10:00',
          recorrente: false,
        });
      },
      error: (err) => console.error('Erro ao criar lembrete no backend:', err),
    });
  }
}
