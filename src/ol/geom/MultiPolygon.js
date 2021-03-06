/**
 * @module ol/geom/MultiPolygon
 */
import {extend} from '../array.js';
import {closestSquaredDistanceXY} from '../extent.js';
import GeometryLayout from '../geom/GeometryLayout.js';
import GeometryType from '../geom/GeometryType.js';
import MultiPoint from '../geom/MultiPoint.js';
import Polygon from '../geom/Polygon.js';
import SimpleGeometry from '../geom/SimpleGeometry.js';
import {linearRingss as linearRingssArea} from '../geom/flat/area.js';
import {linearRingss as linearRingssCenter} from '../geom/flat/center.js';
import {assignClosestMultiArrayPoint, multiArrayMaxSquaredDelta} from '../geom/flat/closest.js';
import {linearRingssContainsXY} from '../geom/flat/contains.js';
import {deflateMultiCoordinatesArray} from '../geom/flat/deflate.js';
import {inflateMultiCoordinatesArray} from '../geom/flat/inflate.js';
import {getInteriorPointsOfMultiArray} from '../geom/flat/interiorpoint.js';
import {intersectsLinearRingMultiArray} from '../geom/flat/intersectsextent.js';
import {linearRingsAreOriented, orientLinearRingsArray} from '../geom/flat/orient.js';
import {quantizeMultiArray} from '../geom/flat/simplify.js';

/**
 * @classdesc
 * Multi-polygon geometry.
 *
 * @api
 */
class MultiPolygon extends SimpleGeometry {

  /**
   * @param {Array<Array<Array<import("../coordinate.js").Coordinate>>>|Array<number>} coordinates Coordinates.
   *     For internal use, flat coordinats in combination with `opt_layout` and `opt_endss` are also accepted.
   * @param {GeometryLayout=} opt_layout Layout.
   * @param {Array<number>=} opt_endss Array of ends for internal use with flat coordinates.
   */
  constructor(coordinates, opt_layout, opt_endss) {

    super();

    /**
     * @type {Array<Array<number>>}
     * @private
     */
    this.endss_ = [];

    /**
     * @private
     * @type {number}
     */
    this.flatInteriorPointsRevision_ = -1;

    /**
     * @private
     * @type {Array<number>}
     */
    this.flatInteriorPoints_ = null;

    /**
     * @private
     * @type {number}
     */
    this.maxDelta_ = -1;

    /**
     * @private
     * @type {number}
     */
    this.maxDeltaRevision_ = -1;

    /**
     * @private
     * @type {number}
     */
    this.orientedRevision_ = -1;

    /**
     * @private
     * @type {Array<number>}
     */
    this.orientedFlatCoordinates_ = null;

    if (!opt_endss && !Array.isArray(coordinates[0])) {
      let layout = this.getLayout();
      const flatCoordinates = [];
      const endss = [];
      for (let i = 0, ii = coordinates.length; i < ii; ++i) {
        const polygon = coordinates[i];
        if (i === 0) {
          layout = polygon.getLayout();
        }
        const offset = flatCoordinates.length;
        const ends = polygon.getEnds();
        for (let j = 0, jj = ends.length; j < jj; ++j) {
          ends[j] += offset;
        }
        extend(flatCoordinates, polygon.getFlatCoordinates());
        endss.push(ends);
      }
      opt_layout = layout;
      coordinates = flatCoordinates;
      opt_endss = endss;
    }
    if (opt_layout !== undefined && opt_endss) {
      this.setFlatCoordinates(opt_layout, coordinates);
      this.endss_ = opt_endss;
    } else {
      this.setCoordinates(coordinates, opt_layout);
    }

  }

  /**
   * Append the passed polygon to this multipolygon.
   * @param {Polygon} polygon Polygon.
   * @api
   */
  appendPolygon(polygon) {
    /** @type {Array<number>} */
    let ends;
    if (!this.flatCoordinates) {
      this.flatCoordinates = polygon.getFlatCoordinates().slice();
      ends = polygon.getEnds().slice();
      this.endss_.push();
    } else {
      const offset = this.flatCoordinates.length;
      extend(this.flatCoordinates, polygon.getFlatCoordinates());
      ends = polygon.getEnds().slice();
      for (let i = 0, ii = ends.length; i < ii; ++i) {
        ends[i] += offset;
      }
    }
    this.endss_.push(ends);
    this.changed();
  }

  /**
   * Make a complete copy of the geometry.
   * @return {!MultiPolygon} Clone.
   * @override
   * @api
   */
  clone() {
    const len = this.endss_.length;
    const newEndss = new Array(len);
    for (let i = 0; i < len; ++i) {
      newEndss[i] = this.endss_[i].slice();
    }

    return new MultiPolygon(
      this.flatCoordinates.slice(), this.layout, newEndss);
  }

  /**
   * @inheritDoc
   */
  closestPointXY(x, y, closestPoint, minSquaredDistance) {
    if (minSquaredDistance < closestSquaredDistanceXY(this.getExtent(), x, y)) {
      return minSquaredDistance;
    }
    if (this.maxDeltaRevision_ != this.getRevision()) {
      this.maxDelta_ = Math.sqrt(multiArrayMaxSquaredDelta(
        this.flatCoordinates, 0, this.endss_, this.stride, 0));
      this.maxDeltaRevision_ = this.getRevision();
    }
    return assignClosestMultiArrayPoint(
      this.getOrientedFlatCoordinates(), 0, this.endss_, this.stride,
      this.maxDelta_, true, x, y, closestPoint, minSquaredDistance);
  }

  /**
   * @inheritDoc
   */
  containsXY(x, y) {
    return linearRingssContainsXY(this.getOrientedFlatCoordinates(), 0, this.endss_, this.stride, x, y);
  }

  /**
   * Return the area of the multipolygon on projected plane.
   * @return {number} Area (on projected plane).
   * @api
   */
  getArea() {
    return linearRingssArea(this.getOrientedFlatCoordinates(), 0, this.endss_, this.stride);
  }

  /**
   * Get the coordinate array for this geometry.  This array has the structure
   * of a GeoJSON coordinate array for multi-polygons.
   *
   * @param {boolean=} opt_right Orient coordinates according to the right-hand
   *     rule (counter-clockwise for exterior and clockwise for interior rings).
   *     If `false`, coordinates will be oriented according to the left-hand rule
   *     (clockwise for exterior and counter-clockwise for interior rings).
   *     By default, coordinate orientation will depend on how the geometry was
   *     constructed.
   * @return {Array<Array<Array<import("../coordinate.js").Coordinate>>>} Coordinates.
   * @override
   * @api
   */
  getCoordinates(opt_right) {
    let flatCoordinates;
    if (opt_right !== undefined) {
      flatCoordinates = this.getOrientedFlatCoordinates().slice();
      orientLinearRingsArray(
        flatCoordinates, 0, this.endss_, this.stride, opt_right);
    } else {
      flatCoordinates = this.flatCoordinates;
    }

    return inflateMultiCoordinatesArray(
      flatCoordinates, 0, this.endss_, this.stride);
  }

  /**
   * @return {Array<Array<number>>} Endss.
   */
  getEndss() {
    return this.endss_;
  }

  /**
   * @return {Array<number>} Flat interior points.
   */
  getFlatInteriorPoints() {
    if (this.flatInteriorPointsRevision_ != this.getRevision()) {
      const flatCenters = linearRingssCenter(
        this.flatCoordinates, 0, this.endss_, this.stride);
      this.flatInteriorPoints_ = getInteriorPointsOfMultiArray(
        this.getOrientedFlatCoordinates(), 0, this.endss_, this.stride,
        flatCenters);
      this.flatInteriorPointsRevision_ = this.getRevision();
    }
    return this.flatInteriorPoints_;
  }

  /**
   * Return the interior points as {@link module:ol/geom/MultiPoint multipoint}.
   * @return {MultiPoint} Interior points as XYM coordinates, where M is
   * the length of the horizontal intersection that the point belongs to.
   * @api
   */
  getInteriorPoints() {
    return new MultiPoint(this.getFlatInteriorPoints().slice(), GeometryLayout.XYM);
  }

  /**
   * @return {Array<number>} Oriented flat coordinates.
   */
  getOrientedFlatCoordinates() {
    if (this.orientedRevision_ != this.getRevision()) {
      const flatCoordinates = this.flatCoordinates;
      if (linearRingsAreOriented(
        flatCoordinates, 0, this.endss_, this.stride)) {
        this.orientedFlatCoordinates_ = flatCoordinates;
      } else {
        this.orientedFlatCoordinates_ = flatCoordinates.slice();
        this.orientedFlatCoordinates_.length =
            orientLinearRingsArray(
              this.orientedFlatCoordinates_, 0, this.endss_, this.stride);
      }
      this.orientedRevision_ = this.getRevision();
    }
    return this.orientedFlatCoordinates_;
  }

  /**
   * @inheritDoc
   */
  getSimplifiedGeometryInternal(squaredTolerance) {
    const simplifiedFlatCoordinates = [];
    const simplifiedEndss = [];
    simplifiedFlatCoordinates.length = quantizeMultiArray(
      this.flatCoordinates, 0, this.endss_, this.stride,
      Math.sqrt(squaredTolerance),
      simplifiedFlatCoordinates, 0, simplifiedEndss);
    return new MultiPolygon(simplifiedFlatCoordinates, GeometryLayout.XY, simplifiedEndss);
  }

  /**
   * Return the polygon at the specified index.
   * @param {number} index Index.
   * @return {Polygon} Polygon.
   * @api
   */
  getPolygon(index) {
    if (index < 0 || this.endss_.length <= index) {
      return null;
    }
    let offset;
    if (index === 0) {
      offset = 0;
    } else {
      const prevEnds = this.endss_[index - 1];
      offset = prevEnds[prevEnds.length - 1];
    }
    const ends = this.endss_[index].slice();
    const end = ends[ends.length - 1];
    if (offset !== 0) {
      for (let i = 0, ii = ends.length; i < ii; ++i) {
        ends[i] -= offset;
      }
    }
    return new Polygon(this.flatCoordinates.slice(offset, end), this.layout, ends);
  }

  /**
   * Return the polygons of this multipolygon.
   * @return {Array<Polygon>} Polygons.
   * @api
   */
  getPolygons() {
    const layout = this.layout;
    const flatCoordinates = this.flatCoordinates;
    const endss = this.endss_;
    const polygons = [];
    let offset = 0;
    for (let i = 0, ii = endss.length; i < ii; ++i) {
      const ends = endss[i].slice();
      const end = ends[ends.length - 1];
      if (offset !== 0) {
        for (let j = 0, jj = ends.length; j < jj; ++j) {
          ends[j] -= offset;
        }
      }
      const polygon = new Polygon(flatCoordinates.slice(offset, end), layout, ends);
      polygons.push(polygon);
      offset = end;
    }
    return polygons;
  }

  /**
   * @inheritDoc
   * @api
   */
  getType() {
    return GeometryType.MULTI_POLYGON;
  }

  /**
   * @inheritDoc
   * @api
   */
  intersectsExtent(extent) {
    return intersectsLinearRingMultiArray(
      this.getOrientedFlatCoordinates(), 0, this.endss_, this.stride, extent);
  }

  /**
   * Set the coordinates of the multipolygon.
   * @param {!Array<Array<Array<import("../coordinate.js").Coordinate>>>} coordinates Coordinates.
   * @param {GeometryLayout=} opt_layout Layout.
   * @override
   * @api
   */
  setCoordinates(coordinates, opt_layout) {
    this.setLayout(opt_layout, coordinates, 3);
    if (!this.flatCoordinates) {
      this.flatCoordinates = [];
    }
    const endss = deflateMultiCoordinatesArray(
      this.flatCoordinates, 0, coordinates, this.stride, this.endss_);
    if (endss.length === 0) {
      this.flatCoordinates.length = 0;
    } else {
      const lastEnds = endss[endss.length - 1];
      this.flatCoordinates.length = lastEnds.length === 0 ?
        0 : lastEnds[lastEnds.length - 1];
    }
    this.changed();
  }
}


export default MultiPolygon;
