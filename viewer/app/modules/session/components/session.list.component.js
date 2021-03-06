(function() {

  'use strict';

  // local variable to save query state
  let _query = {  // set query defaults:
    length: 50,   // page length
    start : 0,    // first item index
    facets: 1     // facets
  };

  const defaultTableState = {
    order         : [['fp', 'asc']],
    visibleHeaders: ['fp', 'lp', 'src', 'p1', 'dst', 'p2', 'pa', 'dbby', 'no', 'info']
  };

  let customCols = require('json!./custom.columns.json');

  let holdingClick = false, timeout;

  /**
   * @class SessionListController
   * @classdesc Interacts with session list
   */
  class SessionListController {

    /* setup --------------------------------------------------------------- */
    /**
     * Initialize global variables for this controller
     * @param $scope          Angular application model object
     * @param $timeout        Angular's wrapper for window.setTimeout
     * @param $location       Exposes browser address bar URL (based on the window.location)
     * @param $routeParams    Retrieve the current set of route parameters
     * @param $anchorScroll   Scrolls to the element related to given hash
     * @param SessionService  Transacts sessions with the server
     * @param FieldService    Retrieves available fields from the server
     *
     * @ngInject
     */
    constructor($scope, $timeout, $location, $routeParams, $anchorScroll,
      SessionService, FieldService) {

      this.$scope         = $scope;
      this.$timeout       = $timeout;
      this.$location      = $location;
      this.$routeParams   = $routeParams;
      this.$anchorScroll  = $anchorScroll;
      this.SessionService = SessionService;
      this.FieldService   = FieldService;

      // offset anchor scroll position to account for navbars
      this.$anchorScroll.yOffset = 140;
    }

    /* Callback when component is mounted and ready */
    $onInit() { // initialize scope variables
      this.loading        = true;   // the page starts out in loading state
      this.currentPage    = 1;      // always start on the first page
      this.query          = _query; // load saved query
      this.stickySessions = [];     // array of open sessions

      this.getTableState(); // IMPORTANT: kicks off the initial search query!


      /* Listen! */
      // watch for pagination changes (from pagination.component)
      this.$scope.$on('change:pagination', (event, args) => {
        // pagination affects length, currentPage, and start
        _query.length = this.query.length = args.length;
        _query.start  = this.query.start  = args.start;

        this.currentPage = args.currentPage;

        this.getData();
      });

      // watch for search expression and date range changes
      // (from search.component)
      let initialized;
      this.$scope.$on('change:search', (event, args) => {
        // either (startTime && stopTime) || date
        if (args.startTime && args.stopTime) {
          _query.startTime  = this.query.startTime  = args.startTime;
          _query.stopTime   = this.query.stopTime   = args.stopTime;
          _query.date       = this.query.date       = null;
        } else if (args.date) {
          _query.date       = this.query.date       = args.date;
          _query.startTime  = this.query.startTime  = null;
          _query.stopTime   = this.query.stopTime   = null;
        }

        _query.expression = this.query.expression = args.expression;
        if (args.bounding) {_query.bounding = this.query.bounding = args.bounding;}

        // reset to the first page, because we are issuing a new query
        // and there may only be 1 page of results
        _query.start = this.query.start = 0;

        this.query.view = args.view;

        // don't issue search when the first change:search event is fired
        if (!initialized) { initialized = true; return; }

        this.getData();
      });

      // watch for additions to search parameters from session detail or map
      this.$scope.$on('add:to:search', (event, args) => {
        // notify children (namely expression typeahead)
        this.$scope.$broadcast('add:to:typeahead', args);
      });

      // watch for changes to time parameters from session detail
      this.$scope.$on('change:time', (event, args) => {
        // notify children (namely search component)
        this.$scope.$broadcast('update:time', args);
      });
    } /* /$onInit */


    /* data retrieve/setup/update ------------------------------------------ */
    /**
     * Makes a request to the Session Service to get the list of sessions
     * that match the query parameters
     */
    getData() {
      this.loading  = true;
      this.error    = false;

      this.stickySessions = []; // clear sticky sessions
      // clear fields to query for but always include protocols field
      this.query.fields   = ['pr'];

      // set the fields to retrieve from the server for each session
      if (this.headers) {
        for (let i = 0; i < this.headers.length; ++i) {
          let field = this.headers[i];
          if (field.children) {
            for (let j = 0; j < field.children.length; ++j) {
              if (field.children[j]) {
                this.query.fields.push(field.children[j].dbField);
              }
            }
          } else {
            this.query.fields.push(field.dbField);
          }
        }
      }

      this.SessionService.get(this.query)
        .then((response) => {
          this.error      = false;
          this.loading    = false;
          this.sessions   = response.data;
          this.mapData    = response.data.map;
          this.graphData  = response.data.graph;

          if (parseInt(this.$routeParams.openAll) === 1) {
            this.openAll();
          }
        })
        .catch((error) => {
          this.error    = error;
          this.loading  = false;
        });
    }

    /**
     * Gets the state of the table (sort order and column order/visibility)
     */
    getTableState() {
      this.SessionService.getTableState()
         .then((response) => {
           this.tableState = response.data;
           if (Object.keys(this.tableState).length === 0) {
             this.tableState = defaultTableState;
           }

           // update the sort order for the session table query
           this.query.sorts = this.tableState.order;

           this.FieldService.get()
              .then((result) => {
                this.fields = result;

                this.setupFields();

                // IMPORTANT: kicks off the initial search query
                this.getData();
              }).catch((error) => { this.error = error; });
         }).catch((error) => { this.error = error; });
    }

    /**
     * Saves the table state
     * @param {bool} stopLoading Whether to stop the loading state when promise returns
     */
    saveTableState(stopLoading) {
      this.SessionService.saveTableState(this.tableState)
         .then(() => {
           if (stopLoading) { this.loading = false; }
         })
         .catch((error) =>  { this.error = error; });
    }

    /**
     * Finds a field object given its id
     * @param {string} fieldId  The unique id of the field
     * @return {Object} field   The field object
     */
    getField(fieldId) {
      for (let key in this.fields) {
        if (this.fields.hasOwnProperty(key)) {
          let item = this.fields[key];
          if (item.dbField === fieldId) {
            return item;
          }
        }
      }

      return undefined;
    }

    /**
     * Maps visible column headers to their corresponding fields
     */
    mapHeadersToFields() {
      this.headers = [];
      for (let i = 0, len = this.tableState.visibleHeaders.length; i < len; ++i) {
        let headerId  = this.tableState.visibleHeaders[i];
        let field     = this.getField(headerId);

        if (field) { this.headers.push(field); }
      }
    }

    /**
     * Sets up the fields for the column visibility typeahead and column headers
     * by adding custom columns to the visible columns list and table
     */
    setupFields() {
      for (let key in customCols) {
        if (customCols.hasOwnProperty(key)) {
          this.fields[key] = customCols[key];
          let children = this.fields[key].children;
          // expand all the children
          for (let c in children) {
            // (replace fieldId with field object)
            if (children.hasOwnProperty(c)) {
              if (typeof children[c] !== 'object') {
                children[c] = this.getField(children[c]);
              }
            }
          }
        }
      }

      this.mapHeadersToFields();

      // convert fields map to array (for ng-repeat with filter and group)
      // and remove duplicate fields (e.g. 'host.dns' & 'dns.host')
      let existingFieldsLookup = {}; // lookup map of fields in fieldsArray
      this.fieldsArray = [];
      for (let f in this.fields) {
        if (this.fields.hasOwnProperty(f)) {
          let field = this.fields[f];
          if (!existingFieldsLookup.hasOwnProperty(field.exp)) {
            existingFieldsLookup[field.exp] = field;
            this.fieldsArray.push(field);
          }
        }
      }
    }


    /* exposed functions --------------------------------------------------- */
    /* SESSION DETAIL */
    /**
     * Toggles the display of the session detail for each session
     * @param {Object} session The session to expand, collapse details
     */
    toggleSessionDetail(session) {
      session.expanded = !session.expanded;

      if (session.expanded) {
        this.stickySessions.push(session);
      } else {
        let index = this.stickySessions.indexOf(session);
        if (index >= 0) { this.stickySessions.splice(index, 1); }
      }
    }

    /* Opens up to 10 session details in the table */
    openAll() {
      // opening too many session details at once is bad!
      if (this.sessions.data.length > 10) {
        alert('You\'re trying to open too many session details at once! I\'ll only open the first 10 for you, sorry!');
      }

      let len = Math.min(this.sessions.data.length, 10);

      for (let i = 0; i < len; ++i) {
        this.toggleSessionDetail(this.sessions.data[i]);
      }

      // unset open all for future queries
      this.$location.search('openAll', null);
    }


    /* TABLE SORTING */
    /**
     * Determines if the table is being sorted by specified column
     * @param {string} id The id of the column
     */
    isSorted(id) {
      for (let i = 0; i < this.tableState.order.length; ++i) {
        if (this.tableState.order[i][0] === id) { return i; }
      }

      return -1;
    }

    /**
     * Sorts the sessions by the clicked column
     * (if the user issues a click less than 300ms long)
     * @param {Object} event  The click event that triggered the sort
     * @param {string} id     The id of the column to sort by
     */
    sortBy(event, id) {
      // if the column click was a click and hold/drag, don't issue new query
      if (holdingClick) { return; }

      if (this.isSorted(id) >= 0) {
        // the table is already sorted by this element
        if (!event.shiftKey) {
          let item = this.toggleSortOrder(id);
          this.tableState.order = [item];
        } else {
          // if it's a shift click - toggle the order between 3 states:
          // 'asc' -> 'desc' -> removed from sorts
          if (this.getSortOrder(id) === 'desc') {
            for (let i = 0, len = this.tableState.order.length; i < len; ++i) {
              if (this.tableState.order[i][0] === id) {
                this.tableState.order.splice(i, 1);
                break;
              }
            }
          } else {
            this.toggleSortOrder(id);
          }
        }
      } else { // sort by a new column
        if (!event.shiftKey) {
          // if it's a regular click - remove other sorts and add this one
          this.tableState.order = [[ id, 'asc' ]];
        } else {
          // if it's a shift click - add it to the list
          this.tableState.order.push([ id, 'asc' ]);
        }
      }

      this.query.sorts = this.tableState.order;

      this.saveTableState();

      this.getData();
    }

    /**
     * Determines the sort order of a column
     * @param {string} id     The unique id of the column
     * @return {string} order The sort order of the column
     */
    getSortOrder(id) {
      for (let i = 0, len = this.tableState.order.length; i < len; ++i) {
        if (this.tableState.order[i][0] === id) {
          return this.tableState.order[i][1];
        }
      }
    }

    /**
     * Toggles the sort order of a column, given its id
     * ('asc' -> 'desc' & 'desc' -> 'asc')
     * @param {string} id   The id of the column to toggle
     * @return {Array} item The sort item with updated order
     */
    toggleSortOrder(id) {
      for (let i = 0, len = this.tableState.order.length; i < len; ++i) {
        let item = this.tableState.order[i];
        if (item[0] === id) {
          if (item[1] === 'asc') { item[1] = 'desc'; }
          else { item[1] = 'asc'; }
          return item;
        }
      }
    }

    /**
     * Sets holdingClick to true if the user holds the click for
     * 300ms or longer. If the user clicks and holds/drags, the
     * sortBy function returns immediately and does not issue query
     */
    mouseDown() {
      holdingClick = false;
      timeout = this.$timeout(() => {
        holdingClick = true;
      }, 300);
    }

    /**
     * Sets holdingClick to false 500ms after mouse up
     */
    mouseUp() {
      this.$timeout.cancel(timeout);
      this.$timeout(() => {
        holdingClick = false;
      }, 500);
    }


    /* COLUMN REORDERING */
    /**
     * Fires when column drop is completed
     * @param {number} newIndex The index of the drop target
     * @param {object} obj      The object dropped
     */
    onDropComplete(newIndex, obj) {
      // set to the first position if dropped on far left column
      if (!newIndex || newIndex < 0) { newIndex = 0; }

      let draggedIndex = this.tableState.visibleHeaders.indexOf(obj.dbField);

      // reorder the visible headers
      if (newIndex >= this.tableState.visibleHeaders.length) {
        let k = newIndex - this.tableState.visibleHeaders.length;
        while ((k--) + 1) {
          this.tableState.visibleHeaders.push(undefined);
        }
      }

      this.tableState.visibleHeaders.splice(newIndex, 0,
         this.tableState.visibleHeaders.splice(draggedIndex, 1)[0]);

      this.mapHeadersToFields();

      this.saveTableState();
    }


    /* COLUMN VISIBILITY */
    /**
     * Determines a column's visibility given its id
     * @param {string} id       The id of the column
     * @return {number} number  The index of the visible header
     */
    isVisible(id) {
      return this.tableState.visibleHeaders.indexOf(id);
    }

    /**
     * Toggles the visibility of a column given its id
     * @param {string} id The id of the column to show/hide (toggle)
     */
    toggleVisibility(id) {
      this.loading = true;

      let index = this.isVisible(id);

      if (index >= 0) { // it's visible
        // remove it from the visible headers list
        this.tableState.visibleHeaders.splice(index,1);
        this.mapHeadersToFields();
      } else { // it's hidden
        // add it to the visible headers list
        this.tableState.visibleHeaders.push(id);
        this.mapHeadersToFields();
        this.getData();
      }

      this.saveTableState(true);
    }


    /* UNIQUE VALUES */
    /**
     * Open a page to view unique values for different fields
     * @param {string} dbField  The field to get unique values for
     * @param {number} counts   1 or 0 whether to include counts of the values
     */
    exportUnique(dbField, counts) {
      this.SessionService.exportUniqueValues(dbField, counts);
    }

  }

  SessionListController.$inject = ['$scope', '$timeout', '$location',
    '$routeParams', '$anchorScroll', 'SessionService', 'FieldService'];


  angular.module('moloch')
    .component('session', {
      template  : require('html!../templates/session.list.html'),
      controller: SessionListController
    });

})();
