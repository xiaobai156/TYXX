import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const pagePath = path.resolve('主用区', '杀号分档.html')
const pageHtml = fs.readFileSync(pagePath, 'utf8')
const scriptMatch = pageHtml.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/i)

if (!scriptMatch) {
  throw new Error('杀号分档页面未找到内嵌脚本')
}

function loadPageLogic(document = {}, localStorage = { getItem: () => null, setItem: () => {} }) {
  const sandbox = {
    clearTimeout,
    console,
    document,
    localStorage,
    setTimeout,
  }
  sandbox.window = sandbox
  vm.runInNewContext(scriptMatch[1], sandbox, { filename: pagePath })
  return sandbox
}

function createFakeDocument(values = {}) {
  const elements = new Map()
  const makeElement = (tagName = 'div') => {
    const element = {
      appendChild(child) {
        this.children.push(child)
      },
      children: [],
      classList: { add: name => element.classes.add(name) },
      classes: new Set(),
      className: '',
      innerHTML: '',
      style: {},
      tagName,
      textContent: '',
      value: '',
    }
    return element
  }

  for (const id of [
    'inputData', 'results', 'summaryArea', 'topBanner', 'rangeResult', 'coverageStatus',
    'minPercent', 'maxPercent', 'frequencyThreshold', 'frequencyThresholdLabel',
    'frequencyCopyStatus', 'copyMinPercent', 'copyMaxPercent', 'copyPercentLowerLabel', 'percentCopyStatus',
  ]) {
    const element = makeElement('div')
    element.value = values[id] ?? ''
    elements.set(id, element)
  }

  return {
    body: makeElement('body'),
    createElement: tagName => makeElement(tagName),
    execCommand: () => true,
    getElementById: id => elements.get(id) ?? null,
  }
}

const sampleGroups = [
  { frequency: 40, numbers: ['14'] },
  { frequency: 35, numbers: ['05'] },
  { frequency: 34, numbers: ['17'] },
  { frequency: 30, numbers: ['26', '41', '49'] },
]

const percentGroups = [
  { frequency: 210, numbers: ['01'] },
  { frequency: 150, numbers: ['02'] },
  { frequency: 147, numbers: ['03'] },
  { frequency: 146, numbers: ['04'] },
  { frequency: 30, numbers: ['05'] },
]

test('侧边栏提供次数与百分比两个复制入口', () => {
  assert.match(pageHtml, /id=["']copySidebar["']/)
  assert.match(pageHtml, /id=["']copySidebarToggle["']/)
  assert.match(pageHtml, /aria-expanded=["']false["']/)
  assert.doesNotMatch(pageHtml, /class=["']copy-sidebar open["']/)
  assert.match(pageHtml, /id=["']copyByFrequencyButton["']/)
  assert.match(pageHtml, /id=["']copyByPercentButton["']/)
})

test('按自定义次数筛选时包含阈值本身，并按频次倒序', () => {
  const { getGroupsByFrequencyThreshold } = loadPageLogic()

  assert.deepEqual(
    getGroupsByFrequencyThreshold(sampleGroups, 35).map(group => group.frequency),
    [40, 35],
  )
})

test('按侧边栏下限百分比筛选时复制下限以下的分组', () => {
  const { getGroupsByPercentThreshold } = loadPageLogic()

  assert.deepEqual(
    getGroupsByPercentThreshold(percentGroups, 210, 70).map(group => group.frequency),
    [147, 146, 30],
  )
  assert.deepEqual(
    getGroupsByPercentThreshold(percentGroups, 210, 16).map(group => group.frequency),
    [30],
  )
})

test('侧边栏复制内容按截图格式逐组换行', () => {
  const { buildCopyText } = loadPageLogic()

  assert.equal(
    buildCopyText(sampleGroups.slice(0, 2)),
    '14                      四十次\n05                      三五次',
  )
})

test('输入数据后页面分析结果会同步更新两个侧边栏入口', () => {
  const document = createFakeDocument({
    inputData: '14\n14\n14\n14\n05',
    minPercent: '50',
    maxPercent: '100',
    frequencyThreshold: '2',
    copyMinPercent: '70',
    copyMaxPercent: '100',
  })
  const page = loadPageLogic(document)

  page.analyze()

  assert.equal(document.getElementById('results').children.length, 2)
  assert.equal(document.getElementById('frequencyCopyStatus').textContent, '可复制 1 组 / 1 个数字')
  assert.match(document.getElementById('percentCopyStatus').textContent, /70% - 100%.*可复制 1 组 \/ 1 个数字/)
})

test('侧边栏百分比输入会保存，并在下次加载时恢复', () => {
  const saved = new Map([
    ['copyMinPercent', '70'],
    ['copyMaxPercent', '100'],
  ])
  const storage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, String(value)),
  }
  const document = createFakeDocument({ copyMinPercent: '65', copyMaxPercent: '85' })
  const page = loadPageLogic(document, storage)

  page.onload()
  assert.equal(document.getElementById('copyMinPercent').value, '70')
  assert.equal(document.getElementById('copyMaxPercent').value, '100')

  document.getElementById('copyMinPercent').value = '60'
  document.getElementById('copyMaxPercent').value = '90'
  page.saveCopyPercentSettings()
  assert.equal(saved.get('copyMinPercent'), '60')
  assert.equal(saved.get('copyMaxPercent'), '90')
})
