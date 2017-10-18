import {
	Component,
	OnInit,
	OnChanges,
	ViewChild,
	AfterViewInit,
	ElementRef,
	Input,
	ViewEncapsulation
} from '@angular/core';
import * as d3 from 'd3';

@Component({
	selector: 'app-graph',
	templateUrl: 'graph.component.html',
	styleUrls: ['graph.component.scss']
})

export class GraphComponent implements OnInit {
	@Input() private data: Array < any > ;
	@ViewChild('graph') private graphContainer: ElementRef;
	//dictionary of 'name' : 'node' for easy node access during graph construction
	private nodeDict: any = {};
	//dictionary of 'name' : 'list of connected edges' for easy edge access during graph construction
	private edgeDict: any = {};
	
	//constants defining node visuals
	private nodeRadius : number = 10;
	private nodeStrokeWidth : number = 2;

	//svg dimensions define the play area of our graph
	private svgWidth : number = 1600;
	private svgHeight : number = 600;

	//width of column contained area
	private colWidth : number = 200;

	//reference to graph base svg
	private svg : any;

	//our graph data structure consists of a list of nodes and a list of edges or 'links'
	private graph : any = {nodes:[],links:[]};
	
	//our graph color is inherited from the d3 visual stype
	private color : any;

	//data structures handling graph nodes and links; defined below
	private node : any;
	private link : any;

	//2d list, where each list contains the order in which nodes appear in the column corresponding to the list #
	//note that when using a force directed graph, we ignore the node order as node re-positioning is allowed
	private columnList : any = [];

	//our force directed simulation; we need this reference when udpating the simulation as a whole
	private forceGraph : any;

	/*once ng is initialized, we setup our svg with the specified width and height constants*/
	ngOnInit() {
		let baseThis = this;
		this.svg = d3.select(this.graphContainer.nativeElement).append('svg')
		        .attr("class", "panel")
		        .attr("width", baseThis.svgWidth)
		        .attr("height", baseThis.svgHeight);
	}

	/*load in graph data from prereq file (hosted by data service)*/
	loadGraphData() {
		let baseThis = this;
		d3.json("http://localhost:3100/prereq/CSCI", function(prereqs) {
			let nodeData = prereqs["CSCI_nodes"];
			let metaNodeData = prereqs["meta_nodes"];

			//first construct meta-nodes as standard nodes depend on their existence for edge creation
			for (let metaNode of metaNodeData) {
				let circle = baseThis.addNode(metaNode.meta_uid,metaNode.contains);
			}

			//construct graph nodes
			for (let node of nodeData) {
				let circle = baseThis.addNode(node.course_uid,null);

				//construct edges based off of this node's prereqs and coreqs
				let hasValidEdge = false;
				for (let edge of node.prereq_formula) {
					hasValidEdge = baseThis.addEdge(circle,baseThis.nodeDict[edge],"prereq") || hasValidEdge;
				}
				for (let edge of node.coreq_formula) {
					baseThis.addEdge(circle,baseThis.nodeDict[edge],"coreq");
				}
				//start at column 0 if we have no prereqs or our prereqs are not in the dataset
				if (node.prereq_formula.length == 0 || !hasValidEdge) {
					baseThis.setColNum(circle,0);
				}
			}

			//layout standard nodes and edges
			baseThis.layoutColumns();
			baseThis.render(baseThis.graph);
		});
	}

	/*add a node to the graph, and store it in our nodeDict. Column defaults to -1 to indicate that it has not yet been placed*/
	addNode(id:string, containedNodeIds:any) {
		this.graph.nodes.push({"id" : id});
		this.nodeDict[id] = this.graph.nodes[this.graph.nodes.length - 1];
		this.graph.nodes[this.graph.nodes.length-1].containedNodeIds = containedNodeIds;
		this.graph.nodes[this.graph.nodes.length-1].column = -1;
		return this.nodeDict[id];
	}

	/*add an edge to the graph, and store it in our edge dict. Edge gets placed as a connection from both its start node and its end node*/
	addEdge(startNode:any, endNode:any, edgeType:string) {
		if (startNode && endNode) {
			this.graph.links.push({"source" : startNode.id,"target" : endNode.id, 
				"startNodeID" : startNode.id, "endNodeID" : endNode.id});

			if (!this.edgeDict[startNode.id]) {
				this.edgeDict[startNode.id] = [];
			}
			this.edgeDict[startNode.id].push(this.graph.links[this.graph.links.length-1]);
			if (!this.edgeDict[endNode.id]) {
				this.edgeDict[endNode.id] = [];
			}
			this.edgeDict[endNode.id].push(this.graph.links[this.graph.links.length-1]);
			return true;
		}
		return false;
	}

	/*organize nodes into columns based on their prereqs*/
	layoutColumns() {
		//start by laying out nodes branching from first column (nodes with no dependencies)
		for (let node of this.columnList[0]) {
			this.layoutFromNode(node,0);	
		}

		//move meta nodes to the same column as their farthest contained node, and stick lone 4000+ level classes at the end
		for (let key in this.nodeDict) {
			let curNode = this.nodeDict[key];
			if (curNode.containedNodeIds != null) {
				let farthestColumn = 0;
				for (let i = 0; i < curNode.containedNodeIds.length; ++i) {
					let curContainedNode = this.nodeDict[curNode.containedNodeIds[i]];
					farthestColumn = Math.max(farthestColumn,curContainedNode? +curContainedNode.column : 0);
				}
				this.layoutFromNode(curNode,farthestColumn);
			}
			else if (+curNode.id[5] >= 4) {
				if (this.edgeDict[curNode.id] == undefined || this.edgeDict[curNode.id].length == 0) {
					this.setColNum(curNode,this.columnList.length-1,true);
				}
			}
		}
	}

	/*layout nodes stemming from current node*/
	layoutFromNode(node : any, colNum : number) {
		if (node.column != colNum) {
			this.setColNum(node,colNum);
		}
		if (this.edgeDict[node.id]) {
			for (let edge of this.edgeDict[node.id]) {
				if (edge.endNodeID == node.id) {
					this.layoutFromNode(this.nodeDict[edge.startNodeID],colNum+1);
				}
			}	
		}		
	}

	/*move Node node to column colNum*/
	setColNum(node : any, colNum: number, allowColumnChange = false) {
		if (colNum == node.column) {
			return;
		}
		if (node.column == -1 || allowColumnChange) {
			//make sure we have enough columns
			while (this.columnList.length < (colNum+1)) {
				this.columnList.push([]);
			}
			if (node.column != -1) {
				//remove from current column
				let oldColumn = this.columnList[node.column];
				let oldIndex = oldColumn.indexOf(node);
				oldColumn.splice(oldIndex,1);
				//reposition displaced nodes
				for (let i = oldIndex; i <oldColumn.length; ++i) {
					this.columnList[node.column][i].column = node.column;
					
				}
			}
			
			//add to new column
			this.columnList[colNum].push(node);
			node.column = colNum;
		}
	}

	/*move node into the nearest column (to be called upon drag end)*/
	moveToNearestColumn(node : any) {
		node.column = Math.floor((node.x+this.colWidth/4)/this.colWidth);
		if (node.column < 0) {
			node.column = 0;
		}
	}
  
  /*once the view has been initialized, we are ready to begin setting up our graph and loading in data*/
  ngAfterViewInit(){
  	let baseThis = this;
    this.svg = d3.select("svg");

    this.color = d3.scaleOrdinal(d3.schemeCategory20);
    
    this.forceGraph = d3.forceSimulation()
        .force("link", d3.forceLink().id(function (d:{ id: string}) {
        return d.id
      }))
      
        .force("attract", d3.forceManyBody().strength(.005).distanceMax(10000).distanceMin(60))
        .force("repel", d3.forceManyBody().strength(-175).distanceMax(100).distanceMin(10))
        .force("center", d3.forceCenter(baseThis.svgWidth / 2, baseThis.svgHeight / 2));
    
    this.loadGraphData();
  }
  
  /*graph update. Update node positions and constraints, followed by edge positions*/
  ticked() {
  	let baseThis = this;

  	this.node
        .attr("cx", function(d) { 
        	//keep x within column bounds and svg bounds, unless dragging
        	//xBuffer determines how much padding we need to keep between the node and the edge of the column or svg
        	let xBuffer = baseThis.nodeRadius+baseThis.nodeStrokeWidth;
        	let columnXMin = d.dragging ? 0 : (+d.column)*baseThis.colWidth + 10;
        	let columnXMax = d.dragging ? baseThis.svgWidth : (+d.column)*baseThis.colWidth + 90;
        	return d.x = Math.max(xBuffer + columnXMin, Math.min(columnXMax - xBuffer, d.x)); 

        })
        //keep y within svg bounds
        .attr("cy", function(d) { return d.y = Math.max(baseThis.nodeRadius+baseThis.nodeStrokeWidth, 
        	Math.min(baseThis.svgHeight - baseThis.nodeRadius - baseThis.nodeStrokeWidth, d.y)); });

    //update links after nodes, in order to ensure that links do not lag behind node updates
    this.link
        .attr("x1", function(d) { return d.source.x; })
        .attr("y1", function(d) { return d.source.y; })
        .attr("x2", function(d) { return d.target.x; })
        .attr("y2", function(d) { return d.target.y; });

  }
  
  /*adds the graph to the page. This is the last step to bring up our force directed graph*/
  render(graph){
  	let baseThis = this;
    this.link = this.svg.append("g")
    .attr("class", "links")
    .selectAll("line")
    .data(graph.links)
    .enter().append("line")
      .attr("stroke-width", function(d) { return 2; })
      .attr("stroke","#D57F7F");

    this.node = this.svg.append("g")
    .attr("class", "nodes")
    .selectAll("circle")
    .data(graph.nodes)
    .enter().append("circle")
      .attr("r", baseThis.nodeRadius)
      .attr("fill", (d)=> { return this.color(d.group); })
      .attr("stroke","black")
      .attr("stroke-width",baseThis.nodeStrokeWidth)
      .call(d3.drag()
          .on("start", (d)=>{return this.dragstarted(d)})
          .on("drag", (d)=>{return this.dragged(d)})
          .on("end", (d)=>{return this.dragended(d)}));

    this.node.append("title")
      .text(function(d) { return d.id; });

    this.forceGraph
      .nodes(graph.nodes)
      .on("tick", ()=>{return this.ticked()});

    this.forceGraph.force("link")
      .links(graph.links);  
    console.log(graph);
  }
  
  /*drag update*/
  dragged(d) {
    d.fx = d3.event.x;
    d.fy = d3.event.y;
  }
  
  /*finished dragging; snap to the nearest column*/
  dragended(d) {
    if (!d3.event.active) this.forceGraph.alphaTarget(0);
    d.fx = null;
    d.fy = null;
    d.dragging = false;
    this.moveToNearestColumn(d);
  }
  
  /*started draggingl mark the drag node as being dragged*/
  dragstarted(d) {
    if (!d3.event.active) this.forceGraph.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
    d.dragging = true;
  }
}