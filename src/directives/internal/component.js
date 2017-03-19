import { cloneNode } from '../../parsers/template'
import { COMPONENT } from '../priorities'
import {
  extractContent,
  createAnchor,
  replace,
  hyphenate,
  warn,
  cancellable,
  extend,
  toArray,
  getAttr,
  isArray,
  isObject,
  isLiteral
} from '../../util/index'

import { parseDirective } from '../../parsers/directive';

export default {

  priority: COMPONENT,

  params: [
    'keep-alive',
    'transition-mode',
    'inline-template'
  ],

  /**
   * Setup. Two possible usages:
   *
   * - static:
   *   <comp> or <div v-component="comp">
   *
   * - dynamic:
   *   <component :is="view">
   */

  bind () {
    if (!this.el.__vue__) {
      // keep-alive cache
      this.keepAlive = this.params.keepAlive
      if (this.keepAlive) {
        this.cache = {}
      }
      // check inline-template
      if (this.params.inlineTemplate) {
        // extract inline template as a DocumentFragment
        this.inlineTemplate = extractContent(this.el, true)
      }
      // component resolution related state
      this.pendingComponentCb =
      this.Component = null
      // transition related state
      this.pendingRemovals = 0
      this.pendingRemovalCb = null
      // create a ref anchor
      this.anchor = createAnchor('v-component')
      replace(this.el, this.anchor)
      // remove is attribute.
      // this is removed during compilation, but because compilation is
      // cached, when the component is used elsewhere this attribute
      // will remain at link time.
      this.el.removeAttribute('is')
      this.el.removeAttribute(':is')
      // remove ref, same as above
      if (this.descriptor.ref) {
        this.el.removeAttribute('v-ref:' + hyphenate(this.descriptor.ref))
      }
      // Spread `v-bind`, `v-on` object as the properties of real component.
      var self = this;
      ['v-bind', 'v-on'].forEach(function (attr) {
        if (self.el.hasAttribute(attr)) {
          var value = getAttr(self.el, attr)
          self.spreadAttrs(attr, value)
        }
      });
      // if static, build right now.
      if (this.literal) {
        this.setComponent(this.expression)
      }
    } else {
      process.env.NODE_ENV !== 'production' && warn(
        'cannot mount component "' + this.expression + '" ' +
        'on already mounted element: ' + this.el
      )
    }
  },

  /**
   * Public update, called by the watcher in the dynamic
   * literal scenario, e.g. <component :is="view">
   */

  update (value) {
    if (!this.literal) {
      this.setComponent(value)
    }
  },

  /**
   * Spread object as attributes of the current element.
   *
   * `<component is="panel" v-bind="{name: 'Panel', title: 'Info'}"/>`
   * will be equal to `<panel v-bind:name="'Panel'" v-bind:title="'Info'"/>`
   *
   * @param {String} prefix e.g. `v-bind` or `v-on`.
   * @param {String} value The expression which presents object value.
   */

  spreadAttrs: function(prefix, value) {
    if (!value) return

    var parsed = parseDirective(value)
    var raw = value

    value = parsed.expression
    if (!isLiteral(value) || parsed.filters) {
      value = (this._scope || this.vm).$get(value)
    }
    if (!isObject(value) || isArray(value)) {
      warn('Literal or array can not be spread.', this.vm)
      return
    }

    var attrRE = /^[\w-]+[\w\d-]*$/
    var self = this
    Object.keys(value).filter(function (key) {
      return attrRE.test(key)
    }).forEach(function (key) {
      self.el.setAttribute(prefix + ':' + hyphenate(key), raw + '[\'' + key + '\']')
    })
  },

  /**
   * Switch dynamic components. May resolve the component
   * asynchronously, and perform transition based on
   * specified transition mode. Accepts a few additional
   * arguments specifically for vue-router.
   *
   * The callback is called when the full transition is
   * finished.
   *
   * @param {String} value
   * @param {Function} [cb]
   */

  setComponent (value, cb) {
    this.invalidatePending()
    if (!value) {
      // just remove current
      this.unbuild(true)
      this.remove(this.childVM, cb)
      this.childVM = null
    } else {
      var self = this
      this.resolveComponent(value, function () {
        self.mountComponent(cb)
      })
    }
  },

  /**
   * Resolve the component constructor to use when creating
   * the child vm.
   *
   * @param {String|Function} value
   * @param {Function} cb
   */

  resolveComponent (value, cb) {
    var self = this
    this.pendingComponentCb = cancellable(function (Component) {
      self.ComponentName =
        Component.options.name ||
        (typeof value === 'string' ? value : null)
      self.Component = Component
      cb()
    })
    this.vm._resolveComponent(value, this.pendingComponentCb)
  },

  /**
   * Create a new instance using the current constructor and
   * replace the existing instance. This method doesn't care
   * whether the new component and the old one are actually
   * the same.
   *
   * @param {Function} [cb]
   */

  mountComponent (cb) {
    // actual mount
    this.unbuild(true)
    var self = this
    var activateHooks = this.Component.options.activate
    var cached = this.getCached()
    var newComponent = this.build()
    if (activateHooks && !cached) {
      this.waitingFor = newComponent
      callActivateHooks(activateHooks, newComponent, function () {
        if (self.waitingFor !== newComponent) {
          return
        }
        self.waitingFor = null
        self.transition(newComponent, cb)
      })
    } else {
      // update ref for kept-alive component
      if (cached) {
        newComponent._updateRef()
      }
      this.transition(newComponent, cb)
    }
  },

  /**
   * When the component changes or unbinds before an async
   * constructor is resolved, we need to invalidate its
   * pending callback.
   */

  invalidatePending () {
    if (this.pendingComponentCb) {
      this.pendingComponentCb.cancel()
      this.pendingComponentCb = null
    }
  },

  /**
   * Instantiate/insert a new child vm.
   * If keep alive and has cached instance, insert that
   * instance; otherwise build a new one and cache it.
   *
   * @param {Object} [extraOptions]
   * @return {Vue} - the created instance
   */

  build (extraOptions) {
    var cached = this.getCached()
    if (cached) {
      return cached
    }
    if (this.Component) {
      // default options
      var options = {
        name: this.ComponentName,
        el: cloneNode(this.el),
        template: this.inlineTemplate,
        // make sure to add the child with correct parent
        // if this is a transcluded component, its parent
        // should be the transclusion host.
        parent: this._host || this.vm,
        // if no inline-template, then the compiled
        // linker can be cached for better performance.
        _linkerCachable: !this.inlineTemplate,
        _ref: this.descriptor.ref,
        _asComponent: true,
        _isRouterView: this._isRouterView,
        // if this is a transcluded component, context
        // will be the common parent vm of this instance
        // and its host.
        _context: this.vm,
        // if this is inside an inline v-for, the scope
        // will be the intermediate scope created for this
        // repeat fragment. this is used for linking props
        // and container directives.
        _scope: this._scope,
        // pass in the owner fragment of this component.
        // this is necessary so that the fragment can keep
        // track of its contained components in order to
        // call attach/detach hooks for them.
        _frag: this._frag
      }
      // extra options
      // in 1.0.0 this is used by vue-router only
      /* istanbul ignore if */
      if (extraOptions) {
        extend(options, extraOptions)
      }
      var child = new this.Component(options)
      if (this.keepAlive) {
        this.cache[this.Component.cid] = child
      }
      // there needs a way for watching nested components' mutation,
      // so put them into props.children
      if (child.$parent) {
        let parent = child.$parent
        let children = parent.props.children
        let scope = this._scope
        // in an inline v-for, the child should be put to the location
        // which the $index of scope represents.
        // if this isn't in v-for or scope.$index is the tail of props.children,
        // just push the child into the props.children of parent.
        if (scope && scope.$index < children.length) {
          children.splice(scope.$index, 0, child)
          // NOTE: the child has been put into the $children of parent,
          // so create new array to keep the right order.
          parent.$children = [].concat(children)
        } else {
          children.push(child)
        }
      }

      this.nestBuild(child._context, child)

      /* istanbul ignore if */
      if (process.env.NODE_ENV !== 'production' &&
          this.el.hasAttribute('transition') &&
          child._isFragment) {
        warn(
          'Transitions will not work on a fragment instance. ' +
          'Template: ' + child.$options.template,
          child
        )
      }
      return child
    }
  },

  /**
   * Deeply compile child node for creating nested components
   *
   * @param {Vue} context
   * @param {Vue} host
   */

  nestBuild (context, host) {
    if (!this.el.hasChildNodes()) {
      return
    }

    var el = cloneNode(this.el)
    var scope = host
      ? host._scope
      : this._scope
    var childNodes = toArray(el.childNodes)
    var unlinks = [];

    for (var i = 0, l = childNodes.length; i < l; i++) {
      var unlink = context.$compile(childNodes[i], host, scope, this._frag)
      unlinks.push(unlink)
    }

    this.nestUnlink = function () {
      var i = unlinks.length
      while (i--) {
        unlinks[i]()
      }
    }
  },

  /**
   * Try to get a cached instance of the current component.
   *
   * @return {Vue|undefined}
   */

  getCached () {
    return this.keepAlive && this.cache[this.Component.cid]
  },

  /**
   * Teardown the current child, but defers cleanup so
   * that we can separate the destroy and removal steps.
   *
   * @param {Boolean} defer
   */

  unbuild (defer) {
    if (this.waitingFor) {
      if (!this.keepAlive) {
        this.waitingFor.$destroy()
      }
      this.waitingFor = null
    }
    var child = this.childVM
    if (!child || this.keepAlive) {
      if (child) {
        // remove ref
        child._inactive = true
        child._updateRef(true)
      }
      return
    }
    // the sole purpose of `deferCleanup` is so that we can
    // "deactivate" the vm right now and perform DOM removal
    // later.
    child.$destroy(false, defer)
  },

  /**
   * Remove current destroyed child and manually do
   * the cleanup after removal.
   *
   * @param {Function} cb
   */

  remove (child, cb) {
    var keepAlive = this.keepAlive
    if (child) {
      // we may have a component switch when a previous
      // component is still being transitioned out.
      // we want to trigger only one lastest insertion cb
      // when the existing transition finishes. (#1119)
      this.pendingRemovals++
      this.pendingRemovalCb = cb
      var self = this
      child.$remove(function () {
        self.pendingRemovals--
        if (!keepAlive) child._cleanup()
        if (!self.pendingRemovals && self.pendingRemovalCb) {
          self.pendingRemovalCb()
          self.pendingRemovalCb = null
        }
        // The removed component maybe is a transclusion host
        // in the nested components, so record the new host
        // to make sure 'v-for' directive can replace the old one.
        child._replaced = self.childVM
      })
    } else if (cb) {
      cb()
    }
  },

  /**
   * Actually swap the components, depending on the
   * transition mode. Defaults to simultaneous.
   *
   * @param {Vue} target
   * @param {Function} [cb]
   */

  transition (target, cb) {
    var self = this
    var current = this.childVM
    // for devtool inspection
    if (current) current._inactive = true
    target._inactive = false
    this.childVM = target
    switch (self.params.transitionMode) {
      case 'in-out':
        target.$before(self.anchor, function () {
          self.remove(current, cb)
        })
        break
      case 'out-in':
        self.remove(current, function () {
          target.$before(self.anchor, cb)
        })
        break
      default:
        self.remove(current)
        target.$before(self.anchor, cb)
    }
  },

  /**
   * Unbind.
   */

  unbind () {
    this.invalidatePending()
    if (this.nestUnlink) {
      this.nestUnlink()
    }
    // Do not defer cleanup when unbinding
    this.unbuild()
    // destroy all keep-alive cached instances
    if (this.cache) {
      for (var key in this.cache) {
        this.cache[key].$destroy()
      }
      this.cache = null
    }
  }
}

/**
 * Call activate hooks in order (asynchronous)
 *
 * @param {Array} hooks
 * @param {Vue} vm
 * @param {Function} cb
 */

function callActivateHooks (hooks, vm, cb) {
  var total = hooks.length
  var called = 0
  hooks[0].call(vm, next)
  function next () {
    if (++called >= total) {
      cb()
    } else {
      hooks[called].call(vm, next)
    }
  }
}
