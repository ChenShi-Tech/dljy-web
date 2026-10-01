<script setup lang="ts">
import HedgeHint from '../HedgeHint.vue'

// 维护 · 区间方案（openspec build-midlong-spot-hedging HB-01..04/HB-06，design D10；ChenShi-Tech/dljy#3423）。
//
// 预置方案只读且带出处（推断数值标「推断，仅供参考」）；自定义方案按 HB-03 预校验（与后端同一份 validateSchemeTiers），
// 校验失败与后端 422 都按 details.field 定位到具体档位输入框；自定义方案每次修改追加新版本。
// 切换生效必须填写原因，可预约生效时刻（北京时间，不得早于当前时刻）；乐观令牌取未关闭生效行的 activationId，冲突 409 提示刷新后重试。
import { computed, ref } from 'vue'
import {
  addBandSchemeVersion, createBandScheme, fetchBandActivation, fetchBandPresets, fetchBandSchemes, switchBandActivation,
} from '@/services/hedge/hedgeMaintenanceApi'
import type {
  BandActivationRow, BandActivationState, BandPreset, BandScheme, BandSchemeVersion, BandTiers,
} from '@/services/hedge/hedgeMaintenanceApi'
import {
  BAND_BASIS_LABELS, BAND_TIERS, BAND_TIER_LABELS, BAND_VALUE_ORIGIN_LABELS, INFERENCE_NOTE, activationToken, bandSourceText,
  beijingInputToInstant, buildSchemeTiers, formatBeijingTime, formatPercent, tierDraftFrom,
} from '@/services/hedge/hedgeMaintenanceModel'
import type { BandBasis, BandSide, BandTier, FieldFailure, TierDraft } from '@/services/hedge/hedgeMaintenanceModel'
import { useHedgeTabLifecycle } from '../../useHedgeWorkbench'
import { injectMaintenanceContext, useMaintenanceWrite } from './maintenanceContext'

const context = injectMaintenanceContext()
const { workbench, writable } = context
const writer = useMaintenanceWrite(context)
const busy = writer.busy

const presets = ref<BandPreset[]>([])
const presetNote = ref<string | null>(null)
const schemes = ref<BandScheme[]>([])
const activation = ref<BandActivationState | null>(null)
const loading = ref(false)
const loadErrors = ref<string[]>([])
const status = ref<string | null>(null)

type CustomForm = {
  mode: 'create' | 'version'
  schemeId: number | null
  schemeName: string
  baseVersionNo: number | null
  name: string
  basis: BandBasis
  note: string
  tiers: TierDraft
}
const customForm = ref<CustomForm | null>(null)
const customError = ref<FieldFailure | null>(null)

type ActivateTarget =
  | { kind: 'preset'; presetKey: string; label: string }
  | { kind: 'version'; schemeId: number; versionNo: number; name: string }
const activateForm = ref<{ target: ActivateTarget; reason: string; effectiveFrom: string } | null>(null)
const activateError = ref<FieldFailure | null>(null)

const BASIS_OPTIONS = Object.entries(BAND_BASIS_LABELS) as Array<[BandBasis, string]>
const SIDES: BandSide[] = ['lower', 'upper']

async function load() {
  const current = context.contextRequest()
  loading.value = true
  const [presetRes, schemeRes, activationRes] = await Promise.allSettled([fetchBandPresets(), fetchBandSchemes(), fetchBandActivation()])
  if (!current()) return
  const errors: string[] = []
  if (presetRes.status === 'fulfilled') {
    presets.value = presetRes.value.rows ?? []
    presetNote.value = presetRes.value.note ?? null
  } else errors.push(`预置方案加载失败：${context.failureOf(presetRes.reason).text}`)
  if (schemeRes.status === 'fulfilled') schemes.value = schemeRes.value.rows ?? []
  else errors.push(`公司方案加载失败：${context.failureOf(schemeRes.reason).text}`)
  if (activationRes.status === 'fulfilled') activation.value = activationRes.value
  else errors.push(`生效方案加载失败：${context.failureOf(activationRes.reason).text}`)
  loadErrors.value = errors
  loading.value = false
}

function reset() {
  writer.reset()
  presets.value = []
  presetNote.value = null
  schemes.value = []
  activation.value = null
  loading.value = false
  loadErrors.value = []
  status.value = null
  customForm.value = null
  customError.value = null
  activateForm.value = null
  activateError.value = null
}

useHedgeTabLifecycle(workbench, { load, reset, reloadOnActivate: false })

// ── 展示 ──────────────────────────────────────────────────────────────────

function tierRange(tiers: BandTiers | null | undefined, tier: BandTier) {
  const band = tiers?.[tier] ?? null
  if (!band || (band.lower == null && band.upper == null)) return '档位未设定'
  return `${formatPercent(band.lower)} — ${formatPercent(band.upper)}`
}

function tierSummary(tiers: BandTiers | null | undefined) {
  return BAND_TIERS.map((tier) => `${BAND_TIER_LABELS[tier]} ${tierRange(tiers, tier)}`).join(' · ')
}

function presetSources(preset: BandPreset) {
  const ids = new Set<string>()
  for (const tier of BAND_TIERS) for (const id of preset.tiers[tier]?.sources ?? []) ids.add(id)
  return [...ids].map((id) => ({ id, text: bandSourceText(id) }))
}

function originLabel(origin: string | undefined) {
  return origin ? BAND_VALUE_ORIGIN_LABELS[origin] ?? origin : INFERENCE_NOTE
}

function originText(scheme: BandScheme) {
  if (scheme.origin !== 'PRESET') return '自定义'
  const label = presets.value.find((preset) => preset.key === scheme.presetKey)?.label ?? scheme.presetKey
  return label ? `预置快照·${label}` : '预置快照'
}

function sortedVersions(scheme: BandScheme): BandSchemeVersion[] {
  return [...scheme.versions].sort((a, b) => b.versionNo - a.versionNo)
}

const currentRow = computed(() => activation.value?.current ?? null)
/** 预约中的切换：未关闭、生效时刻在未来的生效行（过渡期当前生效为空，由今明页签以缺口标注）。 */
const scheduledRows = computed<BandActivationRow[]>(() => (activation.value?.history ?? [])
  .filter((row) => row.effectiveTo === null && row.effectiveFrom !== null && Date.parse(row.effectiveFrom) > Date.now()))

function isActiveVersion(scheme: BandScheme, version: BandSchemeVersion) {
  return currentRow.value?.schemeId === scheme.schemeId && currentRow.value?.versionNo === version.versionNo
}

function targetLabel(target: ActivateTarget) {
  return target.kind === 'preset' ? `预置方案「${target.label}」（采用时写入数值快照）` : `「${target.name}」v${target.versionNo}`
}

const tierFieldError = (tier: BandTier, side: BandSide) => customError.value?.field === `tiers.${tier}.${side}`

// ── 自定义方案（HB-03/04）──────────────────────────────────────────────────

function openCustom(preset?: BandPreset) {
  customError.value = null
  customForm.value = {
    mode: 'create', schemeId: null, schemeName: '', baseVersionNo: null,
    name: preset ? `${preset.label}（自定义）` : '',
    basis: preset?.basis ?? 'WITH_MECHANISM', note: '', tiers: tierDraftFrom(preset?.tiers),
  }
}

function openVersion(scheme: BandScheme) {
  const latest = sortedVersions(scheme)[0]
  if (!latest) return
  customError.value = null
  customForm.value = {
    mode: 'version', schemeId: scheme.schemeId, schemeName: scheme.name, baseVersionNo: latest.versionNo,
    name: scheme.name, basis: latest.basis, note: '', tiers: tierDraftFrom(latest.tiers),
  }
}

async function saveCustom() {
  const form = customForm.value
  if (!form) return
  customError.value = null
  const name = form.name.trim()
  if (form.mode === 'create' && !name) {
    customError.value = { field: 'name', message: '请填写方案名称' }
    return
  }
  const built = buildSchemeTiers(form.tiers)
  if (!built.ok) {
    customError.value = { field: built.field, message: built.message }
    return
  }
  const note = form.note.trim() || undefined
  const send = form.mode === 'create'
    ? () => createBandScheme({ name, origin: 'CUSTOM', tiers: built.tiers, basis: form.basis, note })
      .then((saved) => ({ name: saved.name, versionNo: saved.versionNo }))
    : () => addBandSchemeVersion(form.schemeId as number, { tiers: built.tiers, basis: form.basis, note, baseVersionNo: form.baseVersionNo as number })
      .then((saved) => ({ name: form.schemeName, versionNo: saved.versionNo }))
  await writer.run('custom', send, {
    onSuccess(saved) {
      customForm.value = null
      status.value = `已保存「${saved.name}」v${saved.versionNo}（尚未生效；需要时在方案列表里切换生效）`
      void load()
    },
    onFailure(failure) {
      customError.value = { field: failure.field, message: failure.text }
    },
  })
}

// ── 切换生效（HB-04：填写原因、可预约、禁倒签、唯一生效）─────────────────────

function openActivate(target: ActivateTarget) {
  activateError.value = null
  activateForm.value = { target, reason: '', effectiveFrom: '' }
}

async function submitActivate() {
  const form = activateForm.value
  if (!form) return
  activateError.value = null
  const reason = form.reason.trim()
  if (!reason) {
    activateError.value = { field: 'reason', message: '请填写切换原因（记入审计）' }
    return
  }
  const effectiveFrom = beijingInputToInstant(form.effectiveFrom)
  if (effectiveFrom === undefined) {
    activateError.value = { field: 'effectiveFrom', message: '预约生效时刻格式不正确' }
    return
  }
  if (effectiveFrom && Date.parse(effectiveFrom) < Date.now()) {
    activateError.value = { field: 'effectiveFrom', message: '生效时刻不能早于当前时刻（不允许倒签）' }
    return
  }
  const target = form.target
  const rowVersion = activationToken(activation.value)
  let snapshotCreated = false
  await writer.run('activate', async () => {
    let schemeId: number
    let versionNo: number
    if (target.kind === 'preset') {
      const created = await createBandScheme({ name: `预置·${target.label}`, origin: 'PRESET', presetKey: target.presetKey })
      snapshotCreated = true
      schemeId = created.schemeId
      versionNo = created.versionNo
    } else {
      schemeId = target.schemeId
      versionNo = target.versionNo
    }
    return switchBandActivation({
      schemeId, versionNo, reason,
      ...(effectiveFrom ? { effectiveFrom } : {}),
      ...(rowVersion !== undefined ? { rowVersion } : {}),
    })
  }, {
    onSuccess(result) {
      activateForm.value = null
      const when = effectiveFrom ? `将于 ${formatBeijingTime(result.effectiveFrom)} 生效` : '立即生效'
      status.value = `已切换生效方案为「${result.name}」v${result.versionNo}，${when}（同一时刻只有一个生效方案，历史保留）`
      void load()
    },
    onFailure(failure) {
      const note = snapshotCreated ? '（预置快照已建立，可在方案列表中直接切换）' : ''
      activateError.value = { field: failure.field, message: `${failure.text}${note}` }
      if (snapshotCreated) void load()
    },
  })
}
</script>

<template>
  <section class="maint-section" data-test="band-section">
    <div class="section-head">
      <h3>区间方案</h3>
      <span class="spacer" />
      <button data-test="band-refresh" :disabled="loading" @click="load">刷新</button>
    </div>
    <HedgeHint text="套保区间用于判定欠保与过保。同一公司地区同一时刻只采用一个生效方案。" />
    <p v-for="message in loadErrors" :key="message" class="status error">{{ message }}</p>

    <div class="current" data-test="band-current">
      <template v-if="currentRow">
        <b>当前生效：</b>「{{ currentRow.name }}」v{{ currentRow.versionNo }}
        <span v-if="activation?.active?.basis" class="badge">判级依据：{{ BAND_BASIS_LABELS[activation.active.basis] }}</span>
        <span class="hint">自 {{ formatBeijingTime(currentRow.effectiveFrom) }} 起<template v-if="currentRow.reason">；原因：{{ currentRow.reason }}</template></span>
        <p class="hint">{{ tierSummary(activation?.active?.tiers) }}</p>
      </template>
      <template v-else-if="!loading">
        <b>未配置生效方案</b>
        <HedgeHint text="请确认并启用方案，不会自动采用预置区间。" />
      </template>
      <p v-for="row in scheduledRows" :key="row.activationId ?? row.effectiveFrom ?? ''" class="hint" data-test="band-scheduled">
        已预约：「{{ row.name }}」v{{ row.versionNo }} 将于 {{ formatBeijingTime(row.effectiveFrom) }} 生效<template v-if="row.reason">（{{ row.reason }}）</template>
      </p>
    </div>
    <p v-if="status" class="status" data-test="scheme-status">{{ status }}</p>

    <h4>预置方案<HedgeHint text="预置区间只读，均为推断参考。采用时需确认，不自动生效。" /></h4>
    <HedgeHint :text="presetNote" />
    <div class="preset-grid">
      <article v-for="preset in presets" :key="preset.key" class="preset-card" data-test="band-preset">
        <header>
          <b>{{ preset.label }}</b>
          <span class="badge">判级依据：{{ BAND_BASIS_LABELS[preset.basis] ?? preset.basis }}</span>
        </header>
        <p class="hint">{{ preset.scenario }}<HedgeHint :text="presetSources(preset).map(source => `${source.id}：${source.text}`).join('\n')" /></p>
        <table class="maint-table">
          <thead><tr><th>档位</th><th>下限</th><th>上限</th><th>效力与依据</th></tr></thead>
          <tbody>
            <tr v-for="tier in BAND_TIERS" :key="tier">
              <td>{{ BAND_TIER_LABELS[tier] }}</td>
              <td>{{ formatPercent(preset.tiers[tier]?.lower) }}</td>
              <td>{{ formatPercent(preset.tiers[tier]?.upper) }}</td>
              <td>
                <span class="badge warn" data-test="band-preset-origin">{{ originLabel(preset.tiers[tier]?.origin) }}</span>
                <HedgeHint :text="preset.tiers[tier]?.note?.replace(/（[^）]*）/g, '')" />
                <HedgeHint v-for="id in preset.tiers[tier]?.sources ?? []" :key="id" :label="id" :text="presetSources(preset).find(source => source.id === id)?.text" />
              </td>
            </tr>
          </tbody>
        </table>
        <div class="form-actions">
          <button data-test="preset-customize" :disabled="!writable" @click="openCustom(preset)">以此为起点自定义</button>
          <button
            data-test="scheme-activate"
            :disabled="!writable || busy !== null"
            @click="openActivate({ kind: 'preset', presetKey: preset.key, label: preset.label })"
          >采用{{ preset.label }}</button>
        </div>
      </article>
    </div>

    <div class="section-head">
      <h4>公司方案与版本</h4>
      <span class="spacer" />
      <button data-test="band-custom-new" :disabled="!writable" @click="openCustom()">新建自定义方案</button>
    </div>
    <p v-if="!schemes.length && !loading" class="hint">尚未建立方案：可采用预置方案（写入数值快照），或新建自定义方案。</p>
    <div v-for="scheme in schemes" :key="scheme.schemeId" class="scheme" data-test="band-scheme">
      <div class="section-head">
        <b>{{ scheme.name }}</b>
        <span class="badge">{{ originText(scheme) }}</span>
        <span class="spacer" />
        <button
          v-if="scheme.origin === 'CUSTOM'"
          data-test="band-add-version"
          :disabled="!writable"
          @click="openVersion(scheme)"
        >修改（追加新版本）</button>
      </div>
      <div class="table-wrap">
        <table class="maint-table">
          <thead>
            <tr><th>版本</th><th>判级依据</th><th v-for="tier in BAND_TIERS" :key="tier">{{ BAND_TIER_LABELS[tier] }}</th><th>说明</th><th>记录时刻</th><th /></tr>
          </thead>
          <tbody>
            <tr v-for="version in sortedVersions(scheme)" :key="version.versionNo" data-test="band-version">
              <td>v{{ version.versionNo }}</td>
              <td>{{ BAND_BASIS_LABELS[version.basis] ?? version.basis }}</td>
              <td v-for="tier in BAND_TIERS" :key="tier">{{ tierRange(version.tiers, tier) }}</td>
              <td>{{ version.note ?? '—' }}</td>
              <td>{{ formatBeijingTime(version.recordedAt) }}</td>
              <td>
                <span v-if="isActiveVersion(scheme, version)" class="badge ok">生效中</span>
                <button
                  v-else
                  data-test="band-version-activate"
                  :disabled="!writable || busy !== null"
                  @click="openActivate({ kind: 'version', schemeId: scheme.schemeId, versionNo: version.versionNo, name: scheme.name })"
                >切换为生效</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <h4>切换历史</h4>
    <div class="table-wrap">
      <table class="maint-table" data-test="band-history">
        <thead><tr><th>方案</th><th>生效起</th><th>生效止</th><th>原因</th><th>操作人</th><th>操作时刻</th></tr></thead>
        <tbody>
          <tr v-for="row in activation?.history ?? []" :key="row.activationId ?? row.activatedAt ?? ''">
            <td>「{{ row.name }}」v{{ row.versionNo }}</td>
            <td>{{ formatBeijingTime(row.effectiveFrom) }}</td>
            <td>{{ row.effectiveTo ? formatBeijingTime(row.effectiveTo) : '—' }}</td>
            <td>{{ row.reason ?? '—' }}</td>
            <td>{{ row.activatedBy ?? '—' }}</td>
            <td>{{ formatBeijingTime(row.activatedAt) }}</td>
          </tr>
          <tr v-if="!(activation?.history ?? []).length"><td colspan="6" class="hint">暂无切换记录</td></tr>
        </tbody>
      </table>
    </div>

    <div v-if="customForm" class="maint-dialog" role="dialog" aria-modal="true">
      <div class="form-card" data-test="band-custom-form">
        <h4>{{ customForm.mode === 'create' ? '新建自定义方案' : `修改「${customForm.schemeName}」（基于 v${customForm.baseVersionNo} 追加新版本）` }}</h4>
        <div class="form-grid">
          <label v-if="customForm.mode === 'create'" for="band-name">方案名称</label>
          <input
            v-if="customForm.mode === 'create'"
            id="band-name"
            v-model="customForm.name"
            data-test="band-name"
            :class="{ 'field-error': customError?.field === 'name' }"
          />
          <label for="band-basis">判级依据</label>
          <select id="band-basis" v-model="customForm.basis" data-test="band-basis">
            <option v-for="[value, label] in BASIS_OPTIONS" :key="value" :value="value">{{ label }}</option>
          </select>
        </div>
        <table class="maint-table">
          <thead><tr><th>档位</th><th>下限（%）</th><th>上限（%）</th></tr></thead>
          <tbody>
            <tr v-for="tier in BAND_TIERS" :key="tier">
              <td>{{ BAND_TIER_LABELS[tier] }}</td>
              <td v-for="side in SIDES" :key="side">
                <input
                  v-model="customForm.tiers[tier][side]"
                  :data-test="`band-tier-${tier}-${side}`"
                  :class="{ 'field-error': tierFieldError(tier, side) }"
                  inputmode="decimal"
                  placeholder="不设"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p class="hint">界限取 0—200%；同一档同时设定时下限必须小于上限；可以只设一侧（只设下限只判欠保，只设上限只判过保）。</p>
        <div class="form-grid">
          <label for="band-note">说明</label>
          <textarea id="band-note" v-model="customForm.note" data-test="band-note" rows="2" />
        </div>
        <p v-if="customError" class="field-message" data-test="band-custom-error">{{ customError.message }}</p>
        <div class="form-actions">
          <button data-test="band-custom-cancel" @click="customForm = null">取消</button>
          <button class="primary" data-test="band-custom-save" :disabled="!writable || busy !== null" @click="saveCustom">
            {{ busy === 'custom' ? '保存中…' : '保存方案' }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="activateForm" class="maint-dialog" role="dialog" aria-modal="true">
      <div class="form-card" data-test="band-activate-form">
        <h4>切换生效方案</h4>
        <p>切换到：{{ targetLabel(activateForm.target) }}</p>
        <p v-if="currentRow" class="hint">当前生效：「{{ currentRow.name }}」v{{ currentRow.versionNo }}；切换后所有判级改用新方案，历史判级按当时的生效方案保留。</p>
        <div class="form-grid">
          <label for="band-reason">切换原因（必填）</label>
          <textarea
            id="band-reason"
            v-model="activateForm.reason"
            data-test="band-reason"
            rows="2"
            :class="{ 'field-error': activateError?.field === 'reason' }"
          />
          <label for="band-effective-from">预约生效时刻</label>
          <div>
            <input
              id="band-effective-from"
              v-model="activateForm.effectiveFrom"
              type="datetime-local"
              data-test="band-effective-from"
              :class="{ 'field-error': activateError?.field === 'effectiveFrom' }"
            />
            <p class="hint">北京时间；留空即刻生效，不得早于当前时刻。</p>
          </div>
        </div>
        <p v-if="activateError" class="field-message" data-test="band-activate-error">{{ activateError.message }}</p>
        <div class="form-actions">
          <button data-test="band-activate-cancel" @click="activateForm = null">取消</button>
          <button class="primary" data-test="band-activate-submit" :disabled="!writable || busy !== null" @click="submitActivate">
            {{ busy === 'activate' ? '切换中…' : '确认切换' }}
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped src="./maintenance.css"></style>
<style scoped>
.current { padding: 8px 12px; border: 1px solid var(--line); border-radius: 6px; font-size: var(--font-sm); }
.current .hint { margin-left: 6px; }
.current p.hint { margin: 4px 0 0; }
.preset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.preset-card, .scheme { border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }
.preset-card header { display: flex; gap: 8px; align-items: center; }
.source-ref { color: var(--muted); font-size: var(--font-xs); margin-left: 2px; }
</style>

<style scoped>
.preset-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.preset-card { min-width: 0; font-size: var(--font-sm); }
.preset-card .maint-table { width: 100%; }
@media (max-width: 800px) { .preset-grid { grid-template-columns: 1fr; } }
</style>
