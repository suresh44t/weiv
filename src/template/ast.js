import _ from 'lodash'
import vdom from 'virtual-dom'
import Jexl from 'jexl-sync'
import debug from 'debug'
import { HTML_EVENT_ATTRIBUTES } from './html'

const log = debug('weiv:render')

// Expression can exist as child of Node, also as the value of attribute
export class Expression {
  constructor(exp) {
    this.exp = exp
    this.ast = Jexl.parse(exp)
  }

  eval(contextComponent) {
    let val = Jexl.evaluate(this.ast, contextComponent)
    log('Evaluate expression `%s`: %o', this.exp, val)
    // autobind functions
    if (val && typeof val === 'function') {
      val = val.bind(contextComponent)
    }
    return val
  }

  render(contextComponent) {
    console.group('%o', this)
    const val = this.eval(contextComponent)
    const text = (val !== null && val !== undefined) ? String(val) : ''
    console.groupEnd()
    return new vdom.VText(text)
  }
}

export class Text {
  constructor(text) {
    this.text = text
  }

  render(contextComponent) {
    console.log('%o', this)
    return new vdom.VText(this.text)
  }
}

export class Node {
  constructor(contextComponentClass, tagName, attributes) {
    this.contextComponentClass = contextComponentClass
    this.tagName = tagName.toLowerCase()
    this.properties = {} // name -> value (string), except html events: onclick -> value (expression)
    this.directives = [] // @command:(target).(params..) -> expression
    this.children = [] // children nodes
    this.parent = null
    for (let name of Object.keys(attributes)) {
      if (name.match(/@[^@]+/)) { // directive prefix: @
        const directive = this._parseDirective(name, attributes[name])
        if (directive) this.directives.push(directive)
      } else if (_.includes(HTML_EVENT_ATTRIBUTES, name.toLowerCase())) {
        this.properties[name.toLowerCase()] = new Expression(attributes[name])
      } else {
        this.properties[name.toLowerCase()] = attributes[name]
      }
    }
  }

  _parseDirective(name, exp) {
    const pattern = /@(\w+)(:(\w+)((\.\w+)*))?/
    const m = name.match(pattern)
    if (m) {
      let params = []
      if (m[4]) {
        params = _.remove(m[4].split('.'), null)
      }
      const directiveClass = this.contextComponentClass.prototype.$lookupDirective(m[1])
      if (directiveClass) {
        const directive = new directiveClass(m[1], m[3], params, exp)
        if (directive.validate()) return directive
      }
    }
    throw new Error(`Illagal directive attribute format: ${name}`)
  }

  closestComponent() {
    let node = this
    while (node != null) {
      /* eslint no-use-before-define: 0*/
      if (node instanceof Component) return node
      node = node.parent
    }
    return null
  }

  previousSiblingNode() {
    if (this.parent === null) return null
    const index = _.indexOf(this.parent.children, this)
    if (index === 0) return null
    return this.parent.children[index - 1]
  }

  nextSiblingNode() {
    if (this.parent === null) return null
    const index = _.indexOf(this.parent.children, this)
    if (index === this.parent.children.length - 1) return null
    return this.parent.children[index + 1]
  }

  render(contextComponent) {
    console.group('%o', this)
    let stop = _.some(this.directives.map(directive => directive.initialised({contextComponent, node: this})))
    if (stop) return null

    // only `onclick..` attributes is expression
    let properties = _.mapValues(_.cloneDeep(this.properties), attr => attr instanceof Expression ? attr.eval(contextComponent) : attr)

    stop = _.some(this.directives.map(directive => directive.propertiesEvaluated({contextComponent, node: this, properties})))
    if (stop) return null

    const children = _.compact(_.flatMap(this.children, child => child.render(contextComponent)))

    stop = _.some(this.directives.map(directive => directive.childrenRendered({contextComponent, node: this, properties, children})))
    if (stop) return null

    console.groupEnd()
    return vdom.h(this.tagName, properties, children)
  }
}

export class Component extends Node {
  constructor(contextComponentClass, tagName, attributes, componentClass) {
    super(contextComponentClass, tagName, attributes)
    this.componentClass = componentClass
    this.componentId = componentClass.$original.$uniqueid()
    for (let name of Object.keys(attributes)) {
      if (name.match(/@[^@]+/)) { // directive prefix: @
        const directive = this._parseDirective(name, attributes[name])
        if (directive) this.directives.push(directive)
      } else {
        // validate component props
        if (_.includes(Object.keys(componentClass.prototype.$props), name)) {
          this.properties[name] = attributes[name]
        } else {
          console.warn('Illegal commponent props %s in %s', name, componentClass.$class.name)
        }
      }
    }
  }

  render(contextComponent) {
    console.group('%o', this)

    let stop = _.some(this.directives.map(directive => directive.initialised({contextComponent, node: this})))
    if (stop) return null

    const events = {}

    stop = _.some(this.directives.map(directive => directive.eventsPrepared({contextComponent, node: this, events})))
    if (stop) return null

    const properties = _.mapValues(_.cloneDeep(this.properties), prop => prop instanceof Expression ? prop.eval(contextComponent) : prop)

    stop = _.some(this.directives.map(directive => directive.propertiesEvaluated({contextComponent, node: this, properties})))
    if (stop) return null

    const children = _.compact(_.flatMap(this.children, child => child.render(contextComponent)))

    stop = _.some(this.directives.map(directive => directive.childrenRendered({contextComponent, node: this, properties, children})))
    if (stop) return null

    /* eslint new-cap: 0 */
    let childComponent = contextComponent.$children.get(this.componentId)
    if (!childComponent) {
      childComponent = new this.componentClass(this.componentId, contextComponent)
    }

    stop = _.some(this.directives.map(directive => directive.childComponentCreated({contextComponent, node: this, properties, children, childComponent})))
    if (stop) return null

    // process childrent to fill slots
    const slots = {}
    children.forEach(child => {
      const slotName = _.has(child.properties, 'slot') ? child.properties['slot'] : 'default'
      if (childComponent.$slots.has(slotName)) {
        const slot = slots[slotName] || []
        slot.push(child)
        slots[slotName] = slot
      }
    })

    childComponent.$render(properties, events, slots)
    childComponent.$vdom.properties.id = this.componentId // attach an id attribute
    console.groupEnd()

    return childComponent.$vdom
  }
}

export class Slot extends Node {
  constructor(contextComponentClass, tagName, attributes) {
    super(contextComponentClass, tagName, attributes)
    this.name = attributes.name || 'default'
  }

  render(contextComponent) { // return multiple vnodes
    console.group('%o', this)
    let stop = _.some(this.directives.map(directive => directive.initialised({contextComponent, node: this})))
    if (stop) return null

    // only `onclick..` attributes is expression
    let properties = _.mapValues(_.cloneDeep(this.properties), attr => attr instanceof Expression ? attr.eval(contextComponent) : attr)

    stop = _.some(this.directives.map(directive => directive.propertiesEvaluated({contextComponent, node: this, properties})))
    if (stop) return null

    const children = _.compact(_.flatMap(this.children, child => child.render(contextComponent)))

    stop = _.some(this.directives.map(directive => directive.childrenRendered({contextComponent, node: this, properties, children})))
    if (stop) return null

    console.groupEnd()
    if (contextComponent.$vslots.has(this.name) && !_.isEmpty(contextComponent.$vslots.get(this.name))) {
      return contextComponent.$vslots.get(this.name)
    }

    return children
  }
}
