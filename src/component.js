// @flow
import { VNode, h } from 'virtual-dom'
import _ from 'lodash'
// import Hogan from 'hogan.js'
// import parser from 'vdom-parser'
import { parse } from './template'
import { EventEmitter } from 'fbemitter'
import Weiv from './weiv'

export type Prop = {
  type: string,
  default: any,
  required: boolean
}

export type Options = {
  name: string,
  target?: string,
  template?: string,
  props?: {[string]: Prop}
}

export type ComponentPrototype = {
  $name: ?string,
  $target: ?string,
  $template: ?any,
  $props: {[string]: Prop},
  $components: {[string]: any},
  $render: () => VNode,
  $isRoot: () => boolean,
}

function injectPrototype(componentClass, options: Options) {
  const prototype: any = {
    $name: null,
    $target: null,
    $template: null,
    $props: {},
    $components: {},
    $render: function () {
      if (this.$template) {
        const vdom = this.$template.render(this)
        this.$vdom = vdom
      } else {
        this.$vdom = h('div', {}, [])
      }
    },
    $isRoot: function () {
      return !!this.$target
    },
    $lookupComponent: function (tag) {
      let componentClass = this.$components[tag]
      if (componentClass) return componentClass
      return Weiv.$components.get(tag)
    }
  }
  if (options.target) {
    prototype.$target = options.target
  }
  if (options.props) {
    prototype.$props = _.cloneDeep(options.props)
  }
  if (options.components) {
    prototype.$components = _.cloneDeep(options.components)
  }

  Object.assign(componentClass.prototype, prototype) // share meta to all component instances

  if (options.template) {
    parse(options.template.trim(), componentClass)
  }
}

export type ComponentMixin = {
  // only mounted component has a root vdom tree
  $vdom: ?VNode,
  $dom: ?HTMLElement,
  // parent component
  $parent: ?any,
  $root: ?any,
  // event emitter
  $emitter: EventEmitter
}

function injectComponent(parent, component) {
  if (parent) {
    component.$parent = parent
    component.$root = parent.$root
  } else {
    component.$root = component
  }
  component.$vdom = null
  component.$dom = null
  component.$emitter = new EventEmitter()
}

export function Component(options: Options) {
  return function decorator(ComponentClass: any) {
    injectPrototype(ComponentClass, options)

    // const constructor =
    // constructor.prototype = ComponentClass.prototype
    return (parent: any, props: any = {}) => {
      const component = new ComponentClass()
      injectComponent(parent, component) // inject internal component properties
      Object.keys(props).forEach(prop => {
        if (_.includes(Object.keys(component.$props), prop)) { // TODO validate props type
          component[prop] = props[prop] // observable ???
        }
      })
      console.info('%cComponent: %o', 'color: red', component)
      return component
    }
  }
}
